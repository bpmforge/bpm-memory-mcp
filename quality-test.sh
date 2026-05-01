#!/bin/bash

# LM Studio Model Quality Evaluation Script
# Tests 4 prompts across 3 servers with multiple models

RESULTS_DIR="/Users/bmatthews/Code/claude-memory/quality-results"
mkdir -p "$RESULTS_DIR"

# Prompts
PROMPT1='What are the key differences between REST and GraphQL APIs? List 3 pros and cons of each.'
PROMPT2='A farmer has 17 sheep. All but 9 die. How many sheep does the farmer have left? Explain your reasoning step by step.'
PROMPT3='Write a brief, friendly explanation of how Git works for someone who has never used version control.'
PROMPT4='Write a TypeScript function that debounces another function. Include proper types.'

PROMPT_LABELS=("Factual" "Reasoning" "Creative" "Code")

strip_thinking() {
    # Strip <think>...</think> blocks and "Thinking Process:" preambles
    local text="$1"
    # Remove <think>...</think> blocks (multiline)
    text=$(echo "$text" | perl -0777 -pe 's/<think>.*?<\/think>//gs')
    # Remove "Thinking Process:" or similar preambles up to the actual answer
    text=$(echo "$text" | perl -0777 -pe 's/^(Thinking Process:.*?\n\n)//s')
    text=$(echo "$text" | perl -0777 -pe 's/^(Think:.*?\n\n)//s')
    echo "$text"
}

unload_all_models() {
    local server="$1"
    echo "Unloading all models on $server..."
    local loaded=$(curl -s --connect-timeout 5 "http://${server}/v1/models" 2>/dev/null)
    if [ $? -ne 0 ]; then
        echo "  Could not connect to $server"
        return 1
    fi
    local model_ids=$(echo "$loaded" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for m in data.get('data', []):
        print(m['id'])
except:
    pass
" 2>/dev/null)

    for mid in $model_ids; do
        echo "  Unloading $mid..."
        curl -s --connect-timeout 10 "http://${server}/v1/models/unload" \
            -H "Content-Type: application/json" \
            -d "{\"model\": \"$mid\"}" > /dev/null 2>&1
        sleep 2
    done
    echo "  Done unloading."
}

load_model() {
    local server="$1"
    local model="$2"
    local timeout="${3:-120}"
    echo "Loading $model on $server (timeout: ${timeout}s)..."
    curl -s --connect-timeout 10 --max-time "$timeout" "http://${server}/v1/models/load" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$model\"}" > /dev/null 2>&1
    sleep 3
}

warmup_model() {
    local server="$1"
    local model="$2"
    local timeout="${3:-120}"
    echo "  Warming up $model..."
    curl -s --connect-timeout 10 --max-time "$timeout" "http://${server}/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$model\",
            \"messages\": [{\"role\": \"user\", \"content\": \"Hi\"}],
            \"max_tokens\": 5,
            \"temperature\": 0.7
        }" > /dev/null 2>&1
    echo "  Warmup done, waiting 2s..."
    sleep 2
}

send_prompt() {
    local server="$1"
    local model="$2"
    local prompt="$3"
    local label="$4"

    echo "  Sending prompt: $label..."
    local response=$(curl -s --connect-timeout 10 --max-time 120 "http://${server}/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "$(python3 -c "
import json
print(json.dumps({
    'model': '$model',
    'messages': [{'role': 'user', 'content': '''$prompt'''}],
    'max_tokens': 500,
    'temperature': 0.7
}))
")" 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$response" ]; then
        echo "ERROR: No response"
        return
    fi

    local content=$(echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'choices' in data and len(data['choices']) > 0:
        print(data['choices'][0]['message']['content'])
    elif 'error' in data:
        print('ERROR: ' + str(data['error']))
    else:
        print('ERROR: Unexpected response format')
except Exception as e:
    print('ERROR: ' + str(e))
" 2>/dev/null)

    echo "$content"
}

test_model() {
    local server="$1"
    local model="$2"
    local server_label="$3"
    local warmup_timeout="${4:-120}"
    local is_thinking="${5:-false}"

    local safe_name=$(echo "${model}_${server_label}" | tr '/:. ' '____')
    local outfile="$RESULTS_DIR/${safe_name}.txt"

    echo ""
    echo "=============================================="
    echo "=== MODEL: $model @ $server_label ==="
    echo "=============================================="

    # Unload previous models and load this one
    unload_all_models "$server"
    sleep 2
    load_model "$server" "$model" "$warmup_timeout"
    warmup_model "$server" "$model" "$warmup_timeout"

    {
        echo "=== MODEL: $model @ $server_label ==="
        echo ""

        local prompts=("$PROMPT1" "$PROMPT2" "$PROMPT3" "$PROMPT4")
        for i in 0 1 2 3; do
            echo "--- Prompt $((i+1)) (${PROMPT_LABELS[$i]}) ---"
            local raw_response=$(send_prompt "$server" "$model" "${prompts[$i]}" "${PROMPT_LABELS[$i]}")

            if [ "$is_thinking" = "true" ]; then
                local cleaned=$(strip_thinking "$raw_response")
                echo "$cleaned"
            else
                echo "$raw_response"
            fi
            echo ""
            sleep 1
        done
    } | tee "$outfile"

    echo "  Results saved to $outfile"
}

echo "=========================================="
echo "LM Studio Model Quality Evaluation"
echo "Date: $(date)"
echo "=========================================="

# --- Server 1: localhost:1234 (M5 Max 128GB) ---
SERVER1="localhost:1234"
LABEL1="localhost"

test_model "$SERVER1" "google/gemma-3-27b" "$LABEL1" 120 false
test_model "$SERVER1" "qwen/qwen3.5-35b-a3b" "$LABEL1" 120 true
test_model "$SERVER1" "qwen/qwen3-coder-next" "$LABEL1" 120 true
test_model "$SERVER1" "nvidia/nemotron-3-nano-4b" "$LABEL1" 120 true

# nemotron-3-super needs special handling
echo ""
echo ">>> Unloading everything for nemotron-3-super (large model) <<<"
unload_all_models "$SERVER1"
sleep 5
test_model "$SERVER1" "nvidia/nemotron-3-super" "$LABEL1" 180 true

# --- Server 2: 192.168.13.144:1234 (M2 Max 32GB) ---
SERVER2="192.168.13.144:1234"
LABEL2="192.168.13.144"

test_model "$SERVER2" "google/gemma-3-27b" "$LABEL2" 120 false
test_model "$SERVER2" "qwen/qwen3-coder-30b" "$LABEL2" 120 true
test_model "$SERVER2" "google/gemma-3-12b" "$LABEL2" 120 false
test_model "$SERVER2" "nvidia/nemotron-3-nano-4b" "$LABEL2" 120 true

# --- Server 3: 192.168.13.99:1234 ---
SERVER3="192.168.13.99:1234"
LABEL3="192.168.13.99"

test_model "$SERVER3" "gemma-3-12b-it-qat" "$LABEL3" 120 false
test_model "$SERVER3" "qwen3-14b-mlx" "$LABEL3" 120 true
test_model "$SERVER3" "qwen3.5-9b" "$LABEL3" 120 true

echo ""
echo "=========================================="
echo "All tests complete!"
echo "Results saved to: $RESULTS_DIR/"
echo "=========================================="
