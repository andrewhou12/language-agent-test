/**
 * SystemAudioDump - Native macOS system audio capture using ScreenCaptureKit
 *
 * This command-line tool captures system audio and outputs raw PCM data to stdout.
 * Output format: 16-bit signed integers, little-endian, 24kHz, stereo (2 channels)
 *
 * Build:
 *   swiftc -O -o SystemAudioDump SystemAudioDump.swift \
 *     -framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation
 *
 * Build universal binary (arm64 + x86_64):
 *   swiftc -O -target arm64-apple-macosx13.0 -o SystemAudioDump-arm64 SystemAudioDump.swift \
 *     -framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation
 *   swiftc -O -target x86_64-apple-macosx13.0 -o SystemAudioDump-x86_64 SystemAudioDump.swift \
 *     -framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation
 *   lipo -create -output SystemAudioDump SystemAudioDump-arm64 SystemAudioDump-x86_64
 *
 * Requirements:
 *   - macOS 13.0+ (ScreenCaptureKit audio capture)
 *   - Screen Recording permission granted to parent app
 */

import Foundation
import ScreenCaptureKit
import CoreMedia
import AVFoundation
import AppKit  // Needed for GUI initialization

@available(macOS 13.0, *)
class SystemAudioCapture: NSObject, SCStreamDelegate, SCStreamOutput {
    private var stream: SCStream?
    private let sampleRate: Double = 24000
    private let outputHandle = FileHandle.standardOutput

    func start() async throws {
        fputs("Getting shareable content...\n", stderr)

        // Get shareable content (requires screen recording permission)
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        fputs("Found \(content.displays.count) displays, \(content.applications.count) apps\n", stderr)

        guard let display = content.displays.first else {
            fputs("Error: No display found\n", stderr)
            exit(1)
        }

        fputs("Using display: \(display.displayID)\n", stderr)

        // List some running apps for debugging
        for (index, app) in content.applications.prefix(5).enumerated() {
            fputs("App \(index): \(app.applicationName) (bundle: \(app.bundleIdentifier))\n", stderr)
        }

        // Configure stream for audio capture
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(sampleRate)
        config.channelCount = 2
        config.excludesCurrentProcessAudio = true  // Don't capture our own audio

        // On macOS 14+, there's additional audio configuration
        if #available(macOS 14.0, *) {
            fputs("Running on macOS 14+\n", stderr)
            // Try enabling microphone capture as a test (shouldn't be needed but worth trying)
            // config.captureMicrophone = true
        }

        // Print available audio settings
        fputs("Audio settings - capturesAudio: \(config.capturesAudio), excludesCurrent: \(config.excludesCurrentProcessAudio)\n", stderr)

        // We need to capture video too (macOS requirement), but minimal
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 fps minimum
        config.showsCursor = false
        config.queueDepth = 8

        fputs("Config: audio=\(config.capturesAudio), rate=\(config.sampleRate), channels=\(config.channelCount)\n", stderr)

        // Use display-based capture to get ALL system audio
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        fputs("Using display-based capture for all system audio\n", stderr)

        // Create and configure the stream
        stream = SCStream(filter: filter, configuration: config, delegate: self)

        fputs("Adding stream outputs...\n", stderr)

        // Add both audio and video outputs (video required for audio to work on some setups)
        try stream?.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue.global(qos: .userInteractive))
        try stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue.global(qos: .userInteractive))

        fputs("Starting capture...\n", stderr)

        // Start capturing
        try await stream?.startCapture()

        fputs("Audio capture started - play some audio!\n", stderr)
    }

    func stop() async {
        try? await stream?.stopCapture()
        fputs("Audio capture stopped\n", stderr)
    }

    // SCStreamOutput delegate method for audio
    private var audioSampleCount = 0
    private var videoFrameCount = 0

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .screen {
            videoFrameCount += 1
            if videoFrameCount == 1 || videoFrameCount % 10 == 0 {
                fputs("Video frame #\(videoFrameCount)\n", stderr)
            }
            return
        }

        guard type == .audio else { return }
        audioSampleCount += 1

        if audioSampleCount == 1 || audioSampleCount % 100 == 0 {
            fputs("Received audio sample #\(audioSampleCount)\n", stderr)
        }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            fputs("No block buffer\n", stderr)
            return
        }

        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?

        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)

        guard status == kCMBlockBufferNoErr, let data = dataPointer else {
            fputs("Failed to get data pointer\n", stderr)
            return
        }

        // Get audio format
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            fputs("No format description\n", stderr)
            return
        }
        guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
            fputs("No stream description\n", stderr)
            return
        }

        // Convert to 16-bit PCM if needed
        let inputFormat = asbd.pointee

        if audioSampleCount == 1 {
            fputs("Audio format: \(inputFormat.mFormatID), bits: \(inputFormat.mBitsPerChannel), flags: \(inputFormat.mFormatFlags), rate: \(inputFormat.mSampleRate), channels: \(inputFormat.mChannelsPerFrame)\n", stderr)
        }

        if inputFormat.mFormatID == kAudioFormatLinearPCM {
            if inputFormat.mBitsPerChannel == 32 && (inputFormat.mFormatFlags & kAudioFormatFlagIsFloat) != 0 {
                // Convert Float32 to Int16
                let floatData = UnsafeRawPointer(data).bindMemory(to: Float32.self, capacity: length / 4)
                let floatSampleCount = length / 4

                var int16Buffer = [Int16](repeating: 0, count: floatSampleCount)
                for i in 0..<floatSampleCount {
                    let sample = max(-1.0, min(1.0, floatData[i]))
                    int16Buffer[i] = Int16(sample * Float32(Int16.max))
                }

                // Write to stdout
                int16Buffer.withUnsafeBytes { bufferPointer in
                    let data = Data(bufferPointer)
                    outputHandle.write(data)
                }
            } else if inputFormat.mBitsPerChannel == 16 {
                // Already 16-bit, write directly
                let data = Data(bytes: data, count: length)
                outputHandle.write(data)
            } else {
                if audioSampleCount == 1 {
                    fputs("Unsupported PCM format: \(inputFormat.mBitsPerChannel) bits\n", stderr)
                }
            }
        } else {
            if audioSampleCount == 1 {
                fputs("Not linear PCM: \(inputFormat.mFormatID)\n", stderr)
            }
        }
    }

    // SCStreamDelegate methods
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("Stream stopped with error: \(error.localizedDescription)\n", stderr)
        fputs("Error details: \(error)\n", stderr)
        exit(1)
    }

    func outputVideoEffectDidStart(for stream: SCStream) {
        fputs("Video effect started\n", stderr)
    }

    func outputVideoEffectDidStop(for stream: SCStream) {
        fputs("Video effect stopped\n", stderr)
    }
}

// Main entry point
if #available(macOS 13.0, *) {
    // Initialize NSApplication to set up GUI subsystem (required for ScreenCaptureKit)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)  // Run as background app, no dock icon

    let capture = SystemAudioCapture()

    // Handle SIGTERM for graceful shutdown
    signal(SIGTERM) { _ in
        fputs("Received SIGTERM, shutting down...\n", stderr)
        exit(0)
    }

    signal(SIGINT) { _ in
        fputs("Received SIGINT, shutting down...\n", stderr)
        exit(0)
    }

    Task {
        do {
            try await capture.start()
        } catch {
            fputs("Failed to start capture: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    // Run the app's main loop
    app.run()
} else {
    fputs("Error: macOS 13.0 or later required for ScreenCaptureKit audio capture\n", stderr)
    exit(1)
}
