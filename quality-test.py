#!/usr/bin/env python3
"""LM Studio Model Quality Evaluation - Tests 4 prompts across 3 servers."""

import json
import re
import time
import urllib.request
import urllib.error
import sys
import os

RESULTS_DIR = "/Users/bmatthews/Code/claude-memory/quality-results"
os.makedirs(RESULTS_DIR, exist_ok=True)

PROMPTS = [
    ("Factual", "What are the key differences between REST and GraphQL APIs? List 3 pros and cons of each."),
    ("Reasoning", "A farmer has 17 sheep. All but 9 die. How many sheep does the farmer have left? Explain your reasoning step by step."),
    ("Creative", "Write a brief, friendly explanation of how Git works for someone who has never used version control."),
    ("Code", "Write a TypeScript function that debounces another function. Include proper types."),
]

# Server configs: (host, models_list)
# Each model: (model_id, is_thinking, warmup_timeout)
SERVERS = [
    ("localhost:1234", "localhost", [
        ("google/gemma-3-27b", False, 120),
        ("qwen/qwen3.5-35b-a3b", True, 120),
        ("qwen/qwen3-coder-next", True, 120),
        ("nvidia/nemotron-3-nano-4b", True, 120),
        ("nvidia/nemotron-3-super", True, 180),  # big model
    ]),
    ("192.168.13.144:1234", "192.168.13.144", [
        ("google/gemma-3-27b", False, 120),
        ("qwen/qwen3-coder-30b", True, 120),
        ("google/gemma-3-12b", False, 120),
        ("nvidia/nemotron-3-nano-4b", True, 120),
    ]),
    ("192.168.13.99:1234", "192.168.13.99", [
        ("gemma-3-12b-it-qat", False, 120),
        ("qwen3-14b-mlx", True, 120),
        ("qwen3.5-9b", True, 120),
    ]),
]


def http_post(url, data, timeout=120):
    """Send a POST request and return parsed JSON."""
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}


def http_get(url, timeout=10):
    """Send a GET request and return parsed JSON."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}


def strip_thinking(text):
    """Remove <think>...</think> blocks and plaintext thinking preambles."""
    # Remove <think>...</think>
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    # Remove leading "Thinking Process:" or "Think:" preambles
    text = re.sub(r'^(?:Thinking Process|Think|Thought|Reasoning):.*?\n\n', '', text, flags=re.DOTALL)
    return text.strip()


def unload_all_models(server):
    """Unload all currently loaded models on the server."""
    print(f"  Unloading all models on {server}...")
    result = http_get(f"http://{server}/v1/models")
    if "error" in result:
        print(f"    Could not connect: {result['error']}")
        return False

    models = result.get("data", [])
    for m in models:
        mid = m.get("id", "")
        if mid:
            print(f"    Unloading {mid}...")
            http_post(f"http://{server}/v1/models/unload", {"model": mid}, timeout=30)
            time.sleep(2)

    print(f"    All models unloaded.")
    return True


def load_model(server, model, timeout=120):
    """Load a model on the server."""
    print(f"  Loading {model}...")
    result = http_post(f"http://{server}/v1/models/load", {"model": model}, timeout=timeout)
    if "error" in result:
        print(f"    Load error: {result['error']}")
        return False
    time.sleep(3)
    return True


def warmup_model(server, model, timeout=120):
    """Send a warmup request."""
    print(f"  Warming up {model}...")
    result = http_post(f"http://{server}/v1/chat/completions", {
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 5,
        "temperature": 0.7,
    }, timeout=timeout)
    if "error" in result:
        print(f"    Warmup error: {result['error']}")
        return False
    print(f"    Warmup complete, waiting 2s...")
    time.sleep(2)
    return True


def send_prompt(server, model, prompt, label, timeout=120):
    """Send a prompt and return the response content."""
    print(f"    Sending: {label}...")
    t0 = time.time()
    result = http_post(f"http://{server}/v1/chat/completions", {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 500,
        "temperature": 0.7,
    }, timeout=timeout)
    elapsed = time.time() - t0

    if "error" in result:
        return f"ERROR: {result['error']}", elapsed

    try:
        content = result["choices"][0]["message"]["content"]
        return content, elapsed
    except (KeyError, IndexError) as e:
        return f"ERROR: Could not extract response: {e}\nRaw: {json.dumps(result)[:500]}", elapsed


def test_model(server, label, model, is_thinking, warmup_timeout):
    """Test a single model with all 4 prompts."""
    header = f"=== MODEL: {model} @ {label} ==="
    print(f"\n{'=' * len(header)}")
    print(header)
    print(f"{'=' * len(header)}")

    # Unload and load
    unload_all_models(server)
    time.sleep(2)

    if not load_model(server, model, warmup_timeout):
        msg = f"FAILED to load {model} on {server}"
        print(f"  {msg}")
        return header + "\n" + msg + "\n"

    if not warmup_model(server, model, warmup_timeout):
        print(f"  Warmup failed, continuing anyway...")

    output_lines = [header, ""]

    for i, (plabel, prompt) in enumerate(PROMPTS):
        raw_response, elapsed = send_prompt(server, model, prompt, plabel)

        if is_thinking:
            response = strip_thinking(raw_response)
        else:
            response = raw_response

        output_lines.append(f"--- Prompt {i+1} ({plabel}) [{elapsed:.1f}s] ---")
        output_lines.append(response)
        output_lines.append("")

        # Print to console too
        print(f"    {plabel} done ({elapsed:.1f}s)")
        time.sleep(1)

    full_output = "\n".join(output_lines)

    # Save to file
    safe_name = re.sub(r'[/:. ]', '_', f"{model}_{label}")
    outfile = os.path.join(RESULTS_DIR, f"{safe_name}.txt")
    with open(outfile, "w") as f:
        f.write(full_output)
    print(f"  Saved to {outfile}")

    return full_output


def main():
    print("=" * 50)
    print("LM Studio Model Quality Evaluation")
    print(f"Date: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    all_results = []

    for server, label, models in SERVERS:
        print(f"\n{'#' * 50}")
        print(f"# SERVER: {server} ({label})")
        print(f"{'#' * 50}")

        for model, is_thinking, warmup_timeout in models:
            result = test_model(server, label, model, is_thinking, warmup_timeout)
            all_results.append(result)

    # Write combined results
    combined_file = os.path.join(RESULTS_DIR, "all_results.txt")
    with open(combined_file, "w") as f:
        f.write(f"LM Studio Model Quality Evaluation - {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        for r in all_results:
            f.write(r)
            f.write("\n\n")

    print(f"\n{'=' * 50}")
    print(f"All tests complete! Combined results: {combined_file}")
    print(f"Individual results: {RESULTS_DIR}/")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
