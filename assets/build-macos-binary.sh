#!/bin/bash
# Build script for SystemAudioDump macOS binary
# Requires: Xcode Command Line Tools, macOS 12.3+

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building SystemAudioDump..."

# Check for Swift compiler
if ! command -v swiftc &> /dev/null; then
    echo "Error: swiftc not found. Install Xcode Command Line Tools:"
    echo "  xcode-select --install"
    exit 1
fi

# Build for arm64 (Apple Silicon)
echo "Building for arm64..."
swiftc -O -target arm64-apple-macosx13.0 \
    -o SystemAudioDump-arm64 \
    SystemAudioDump.swift \
    -framework ScreenCaptureKit \
    -framework CoreMedia \
    -framework AVFoundation

# Build for x86_64 (Intel)
echo "Building for x86_64..."
swiftc -O -target x86_64-apple-macosx13.0 \
    -o SystemAudioDump-x86_64 \
    SystemAudioDump.swift \
    -framework ScreenCaptureKit \
    -framework CoreMedia \
    -framework AVFoundation

# Create universal binary
echo "Creating universal binary..."
lipo -create -output SystemAudioDump SystemAudioDump-arm64 SystemAudioDump-x86_64

# Cleanup
rm -f SystemAudioDump-arm64 SystemAudioDump-x86_64

# Make executable
chmod +x SystemAudioDump

echo "Build complete: SystemAudioDump"
echo ""
echo "To test manually:"
echo "  ./SystemAudioDump 2>&1 | head -c 1000 | xxd"
echo ""
echo "Note: Requires Screen Recording permission to be granted."
