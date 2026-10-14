import Foundation

// Usage: harness <resources dir> <file.md>  — prints the preview HTML.
let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: harness <resources> <file.md>\n".data(using: .utf8)!)
    exit(2)
}
do {
    let renderer = try MarkdownRenderer(resources: URL(fileURLWithPath: args[1]))
    let markdown = try String(contentsOfFile: args[2], encoding: .utf8)
    print(try renderer.html(markdown: markdown, title: (args[2] as NSString).lastPathComponent))
} catch {
    FileHandle.standardError.write("render failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
