// Local Apple RealityKit Object Capture. No network or cloud inference.
// Run photo-intake.mjs first. Output is an unscaled candidate, never auto-published.
import Foundation
import RealityKit

@main struct ReconstructLandmark {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count == 3 else { fatalError("Usage: reconstruct-landmark INPUT_PHOTO_DIRECTORY OUTPUT.usdz") }
        guard PhotogrammetrySession.isSupported else { fatalError("Object Capture unsupported on this Mac") }
        let input = URL(fileURLWithPath: args[1], isDirectory: true)
        let output = URL(fileURLWithPath: args[2])
        guard output.pathExtension.lowercased() == "usdz" else { fatalError("Output must be USDZ") }
        guard !FileManager.default.fileExists(atPath: output.path) else { fatalError("Output exists; refusing to overwrite") }
        var configuration = PhotogrammetrySession.Configuration()
        configuration.sampleOrdering = .unordered
        configuration.featureSensitivity = .high
        let session = try PhotogrammetrySession(input: input, configuration: configuration)
        try session.process(requests: [.modelFile(url: output, detail: .medium)])
        for try await event in session.outputs {
            switch event {
            case .requestProgress(_, let fraction): print("progress=\(fraction)")
            case .requestError(_, let error): throw error
            case .invalidSample(let id, let reason): print("invalid_sample=\(id) reason=\(reason)")
            case .processingComplete:
                guard FileManager.default.fileExists(atPath: output.path) else { fatalError("No reconstructed file") }
                print("Candidate only: inspect coverage, metric scale and orientation before GLB conversion or publication.")
                return
            default: break
            }
        }
    }
}
