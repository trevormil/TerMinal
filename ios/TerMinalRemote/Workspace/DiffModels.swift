import Foundation

// Pure unified-diff parsing — the phone-side mirror of the desktop's
// parseDiff() in MrDetail.tsx. No UI in this file so the whole thing is
// unit-testable against fixture diffs.

enum DiffLineKind: Equatable {
    case context, add, del
}

struct DiffLine: Equatable, Identifiable {
    /// Position within the file's parsed lines — stable for ForEach.
    let id: Int
    let kind: DiffLineKind
    /// Line content WITHOUT the +/-/space prefix.
    let text: String
    /// Line number in the old file (nil for additions).
    let oldLine: Int?
    /// Line number in the new file (nil for deletions).
    let newLine: Int?
}

struct DiffHunk: Equatable, Identifiable {
    /// Position within the file — stable for ForEach.
    let id: Int
    /// The raw `@@ -a,b +c,d @@ context` header line.
    let header: String
    let lines: [DiffLine]
}

struct DiffFileModel: Equatable, Identifiable {
    let fromPath: String
    let toPath: String
    let hunks: [DiffHunk]
    let isNew: Bool
    let isDeleted: Bool
    let isBinary: Bool
    let additions: Int
    let deletions: Int

    var isRename: Bool {
        !fromPath.isEmpty && !toPath.isEmpty && fromPath != toPath && !isNew && !isDeleted
    }
    /// The path to show and key by — the new path, unless the file was deleted.
    var path: String {
        if isDeleted, !fromPath.isEmpty { return fromPath }
        return toPath.isEmpty ? fromPath : toPath
    }
    var id: String { path }
    var name: String { (path as NSString).lastPathComponent }
    var directory: String { (path as NSString).deletingLastPathComponent }
}

/// A whole parsed diff plus totals — what the file-list screen renders.
struct ParsedDiff: Equatable {
    let files: [DiffFileModel]
    let truncated: Bool

    var additions: Int { files.reduce(0) { $0 + $1.additions } }
    var deletions: Int { files.reduce(0) { $0 + $1.deletions } }
}

enum DiffParser {
    /// Parse a full `git diff` (unified format) into per-file models.
    /// Robust to: binary files, renames, mode changes, new/deleted files,
    /// `\ No newline at end of file` markers, and empty input.
    static func parse(_ text: String) -> [DiffFileModel] {
        guard !text.isEmpty else { return [] }
        var rawLines = text.components(separatedBy: "\n")
        // Drop only the artifact of a trailing newline, not real empty lines.
        if rawLines.last == "" { rawLines.removeLast() }

        var files: [DiffFileModel] = []
        var builder: FileBuilder?

        var i = 0
        while i < rawLines.count {
            let line = rawLines[i]

            if line.hasPrefix("diff --git ") {
                if let b = builder { files.append(b.build()) }
                builder = FileBuilder(gitHeader: line)
                i += 1
                continue
            }

            guard var b = builder else {
                // Diff without a `diff --git` header (rare, e.g. plain `diff -u`
                // output): start a file at the `---` marker.
                if line.hasPrefix("--- ") {
                    builder = FileBuilder(gitHeader: nil)
                    continue  // reprocess this line with a builder in place
                }
                i += 1
                continue
            }

            defer { builder = b }

            switch true {
            case line.hasPrefix("--- "):
                let p = Self.stripPathPrefix(String(line.dropFirst(4)))
                if p.isEmpty { b.isNew = true } else { b.fromPath = p }
            case line.hasPrefix("+++ "):
                let p = Self.stripPathPrefix(String(line.dropFirst(4)))
                if p.isEmpty { b.isDeleted = true } else { b.toPath = p }
            case line.hasPrefix("rename from "):
                b.fromPath = String(line.dropFirst("rename from ".count))
            case line.hasPrefix("rename to "):
                b.toPath = String(line.dropFirst("rename to ".count))
            case line.hasPrefix("new file mode"):
                b.isNew = true
            case line.hasPrefix("deleted file mode"):
                b.isDeleted = true
            case line.hasPrefix("Binary files ") || line.hasPrefix("GIT binary patch"):
                b.isBinary = true
            case line.hasPrefix("@@"):
                if let hunk = Self.parseHunk(rawLines, at: &i, builder: &b) {
                    b.hunks.append(hunk)
                    continue  // parseHunk advanced i past the hunk body
                }
            default:
                break  // index/mode/similarity lines — nothing to record
            }
            i += 1
        }
        if let b = builder { files.append(b.build()) }
        return files
    }

    /// `a/path` / `b/path` → `path`; `/dev/null` → ""; tolerates quoting.
    private static func stripPathPrefix(_ raw: String) -> String {
        var p = raw
        // Paths with special characters arrive quoted: "a/some path".
        if p.hasPrefix("\"") && p.hasSuffix("\"") && p.count >= 2 {
            p = String(p.dropFirst().dropLast())
        }
        if p == "/dev/null" { return "" }
        if p.hasPrefix("a/") || p.hasPrefix("b/") { return String(p.dropFirst(2)) }
        return p
    }

    /// Parse one hunk starting at `lines[i]` (the `@@` header). On success,
    /// leaves `i` at the first line AFTER the hunk body.
    private static func parseHunk(
        _ lines: [String], at i: inout Int, builder b: inout FileBuilder
    ) -> DiffHunk? {
        let header = lines[i]
        guard let match = header.firstMatch(
            of: #/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/#
        ) else { return nil }
        var oldLn = Int(match.1) ?? 0
        var newLn = Int(match.3) ?? 0
        // An omitted length means 1 ("@@ -3 +3 @@"). The declared lengths bound
        // the hunk body, so a bare empty line BETWEEN files can't be swallowed
        // as hunk content.
        var oldLeft = match.2.flatMap { Int($0) } ?? 1
        var newLeft = match.4.flatMap { Int($0) } ?? 1

        var hunkLines: [DiffLine] = []
        var j = i + 1
        loop: while j < lines.count, oldLeft > 0 || newLeft > 0 {
            let raw = lines[j]
            switch raw.first {
            case " ":
                hunkLines.append(DiffLine(
                    id: b.nextLineId(), kind: .context, text: String(raw.dropFirst()),
                    oldLine: oldLn, newLine: newLn))
                oldLn += 1
                newLn += 1
                oldLeft -= 1
                newLeft -= 1
            case "+":
                hunkLines.append(DiffLine(
                    id: b.nextLineId(), kind: .add, text: String(raw.dropFirst()),
                    oldLine: nil, newLine: newLn))
                newLn += 1
                newLeft -= 1
                b.additions += 1
            case "-":
                hunkLines.append(DiffLine(
                    id: b.nextLineId(), kind: .del, text: String(raw.dropFirst()),
                    oldLine: oldLn, newLine: nil))
                oldLn += 1
                oldLeft -= 1
                b.deletions += 1
            case "\\":
                break  // "\ No newline at end of file" — not a content line
            case nil:
                // An entirely empty line inside a hunk is a context line whose
                // content is "" (git emits a bare " " but some tools trim it).
                hunkLines.append(DiffLine(
                    id: b.nextLineId(), kind: .context, text: "",
                    oldLine: oldLn, newLine: newLn))
                oldLn += 1
                newLn += 1
                oldLeft -= 1
                newLeft -= 1
            default:
                break loop  // next file header / hunk header
            }
            j += 1
        }
        i = j
        return DiffHunk(id: b.hunks.count, header: header, lines: hunkLines)
    }

    private struct FileBuilder {
        var fromPath = ""
        var toPath = ""
        var hunks: [DiffHunk] = []
        var isNew = false
        var isDeleted = false
        var isBinary = false
        var additions = 0
        var deletions = 0
        private var lineId = 0

        init(gitHeader: String?) {
            // Fallback paths from `diff --git a/x b/y` — overwritten by the
            // ---/+++/rename lines when present (binary files have no ---/+++).
            if let gitHeader {
                let rest = gitHeader.dropFirst("diff --git ".count)
                if let range = rest.range(of: " b/") {
                    let from = String(rest[rest.startIndex..<range.lowerBound])
                    fromPath = from.hasPrefix("a/") ? String(from.dropFirst(2)) : from
                    toPath = String(rest[range.upperBound...])
                }
            }
        }

        mutating func nextLineId() -> Int {
            defer { lineId += 1 }
            return lineId
        }

        func build() -> DiffFileModel {
            DiffFileModel(
                fromPath: fromPath, toPath: toPath, hunks: hunks,
                isNew: isNew, isDeleted: isDeleted, isBinary: isBinary,
                additions: additions, deletions: deletions)
        }
    }
}
