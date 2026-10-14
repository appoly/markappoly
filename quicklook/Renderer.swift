import Foundation
import JavaScriptCore

/// Turns Markdown into a standalone HTML page using the bundled render.bundle.js
/// (marked + render.js) and style.css. Shared by the extension and the test harness.
final class MarkdownRenderer {
    enum Failure: Error {
        case missingResource(String)
        case script(String)
    }

    private let context: JSContext
    private let render: JSValue
    private let css: String

    init(resources: URL) throws {
        let scriptURL = resources.appendingPathComponent("render.bundle.js")
        let cssURL = resources.appendingPathComponent("style.css")
        guard let script = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            throw Failure.missingResource(scriptURL.path)
        }
        guard let css = try? String(contentsOf: cssURL, encoding: .utf8) else {
            throw Failure.missingResource(cssURL.path)
        }
        guard let context = JSContext() else { throw Failure.script("no JSContext") }
        context.evaluateScript(script, withSourceURL: scriptURL)
        if let exception = context.exception {
            throw Failure.script(exception.toString())
        }
        guard let render = context.objectForKeyedSubscript("markappolyRender"),
            !render.isUndefined
        else {
            throw Failure.script("markappolyRender is not defined")
        }
        self.context = context
        self.render = render
        self.css = css
    }

    func html(markdown: String, title: String) throws -> String {
        context.exception = nil
        let result = render.call(withArguments: [markdown])
        if let exception = context.exception {
            throw Failure.script(exception.toString())
        }
        let body = result?.toString() ?? ""
        return """
            <!doctype html>
            <html>
            <head>
            <meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:">
            <title>\(Self.escape(title))</title>
            <style>\(css)</style>
            </head>
            <body>
            \(body)
            </body>
            </html>
            """
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
