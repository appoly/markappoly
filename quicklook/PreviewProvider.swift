import Foundation
import QuickLookUI
import UniformTypeIdentifiers

/// Data-based Quick Look preview: Finder hands us the file, we hand back HTML.
class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    /// Larger files are previewed truncated so Space stays instant.
    private static let maxBytes = 2 * 1024 * 1024

    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let url = request.fileURL
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        var markdown =
            String(data: data.prefix(Self.maxBytes), encoding: .utf8)
            ?? String(decoding: data.prefix(Self.maxBytes), as: UTF8.self)
        if data.count > Self.maxBytes {
            markdown += "\n\n---\n\n*Preview truncated. Open in Markappoly to see the whole file.*\n"
        }

        let resources = Bundle(for: PreviewProvider.self).resourceURL!
        let renderer = try MarkdownRenderer(resources: resources)
        let html = try renderer.html(markdown: markdown, title: url.lastPathComponent)

        let reply = QLPreviewReply(
            dataOfContentType: .html,
            contentSize: CGSize(width: 820, height: 1000)
        ) { _ in
            Data(html.utf8)
        }
        reply.stringEncoding = .utf8
        reply.title = url.lastPathComponent
        return reply
    }
}
