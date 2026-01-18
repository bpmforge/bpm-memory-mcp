#!/bin/bash
# Claude Memory Plugin Installer
# Installs the claude-memory plugin for Claude Code

set -e

echo "=================================="
echo "Claude Memory Plugin Installer"
echo "=================================="
echo ""

# Check Node.js version
NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 22 ]; then
  echo "Error: Node.js 22+ is required"
  echo "Current version: $(node --version 2>/dev/null || echo 'not installed')"
  exit 1
fi
echo "✓ Node.js version: $(node --version)"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Build the MCP server
echo ""
echo "Building MCP server..."
npm run build

# Check for embedding providers
echo ""
echo "Checking embedding providers..."

OLLAMA_OK=false
LMSTUDIO_OK=false

if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "✓ Ollama detected at localhost:11434"
  OLLAMA_OK=true
else
  echo "○ Ollama not running (optional)"
fi

if curl -s http://localhost:1234/v1/models > /dev/null 2>&1; then
  echo "✓ LM Studio detected at localhost:1234"
  LMSTUDIO_OK=true
else
  echo "○ LM Studio not running (optional)"
fi

if [ "$OLLAMA_OK" = false ] && [ "$LMSTUDIO_OK" = false ]; then
  echo ""
  echo "Warning: No embedding provider detected."
  echo "Install Ollama (https://ollama.ai) or LM Studio (https://lmstudio.ai)"
  echo "and run an embedding model for full functionality."
  echo ""
  echo "Recommended: ollama pull nomic-embed-text"
fi

# Create data directory
mkdir -p ~/.claude-memory

echo ""
echo "=================================="
echo "Installation Complete!"
echo "=================================="
echo ""
echo "To use with Claude Code, add to your MCP settings:"
echo ""
echo "  mcp: {"
echo "    servers: {"
echo "      memory: {"
echo "        command: \"node\","
echo "        args: [\"$(pwd)/mcp/memory-server/dist/index.js\"]"
echo "      }"
echo "    }"
echo "  }"
echo ""
echo "Or copy the skill file to your Claude Code skills directory."
echo ""
