import SwiftUI
import UIKit

// Desktop-parity PR diff review, phone-sized. The desktop's DiffView is a
// sidebar + pane; here it's two screens: a file list, then a per-file
// hunk-by-hunk diff with prev/next so review flows file→file without popping.

// ---- viewed state --------------------------------------------------------

/// Per-(repo, PR) "viewed file" set — the phone-side twin of the desktop's
/// localStorage-backed useViewed(). Persisted in UserDefaults.
@Observable
final class ViewedStore {
    private let key: String
    private(set) var viewed: Set<String>

    init(repo: String, iid: Int) {
        key = "gt.viewed.\(repo).\(iid)"
        viewed = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }

    func isViewed(_ path: String) -> Bool { viewed.contains(path) }

    func toggle(_ path: String) {
        if viewed.contains(path) { viewed.remove(path) } else { viewed.insert(path) }
        save()
    }

    func setAll(_ paths: [String], viewed on: Bool) {
        viewed = on ? Set(paths) : []
        save()
    }

    private func save() {
        UserDefaults.standard.set(Array(viewed).sorted(), forKey: key)
    }
}

// ---- screen 1: file list -------------------------------------------------

struct PrDiffView: View {
    let client: BridgeClient
    let repo: String
    let iid: Int

    @State private var parsed: ParsedDiff?
    @State private var error: String?
    @State private var viewed: ViewedStore

    /// `preloaded`: when PrDetailView already fetched the diff for its
    /// summary line, reuse it instead of fetching again.
    init(client: BridgeClient, repo: String, iid: Int, preloaded: ParsedDiff? = nil) {
        self.client = client
        self.repo = repo
        self.iid = iid
        _parsed = State(initialValue: preloaded)
        _viewed = State(initialValue: ViewedStore(repo: repo, iid: iid))
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            if let error {
                ScrollView {
                    GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                        .padding(14)
                }
            } else if let parsed {
                fileList(parsed)
            } else {
                ProgressView().tint(GT.accentLight)
            }
        }
        .navigationTitle("Diff · !\(iid)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            guard parsed == nil else { return }
            do {
                let text = try await client.prDiff(repo: repo, iid: iid)
                parsed = ParsedDiff(files: DiffParser.parse(text.text), truncated: text.truncated)
                error = nil
            } catch { self.error = error.localizedDescription }
        }
    }

    @ViewBuilder
    private func fileList(_ parsed: ParsedDiff) -> some View {
        let paths = parsed.files.map(\.path)
        let viewedCount = paths.filter { viewed.isViewed($0) }.count
        let allViewed = viewedCount == paths.count && !paths.isEmpty
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                if parsed.truncated {
                    Text("Shown in part — the Mac capped this diff for the wire.")
                        .font(GT.sans(11)).foregroundStyle(GT.yellow)
                }
                if parsed.files.isEmpty {
                    GTPanel {
                        Text("No diff (or the forge returned empty).")
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                    }
                } else {
                    HStack(spacing: 8) {
                        Text("\(parsed.files.count) files")
                            .font(GT.sans(12, .semibold)).foregroundStyle(GT.text)
                        Text("+\(parsed.additions)").font(GT.mono(11)).foregroundStyle(GT.green)
                        Text("−\(parsed.deletions)").font(GT.mono(11)).foregroundStyle(GT.red)
                        if viewedCount > 0 {
                            Text("· \(viewedCount) viewed")
                                .font(GT.sans(11)).foregroundStyle(GT.textFaint)
                        }
                        Spacer()
                        Button(allViewed ? "Clear" : "Mark all") {
                            viewed.setAll(paths, viewed: !allViewed)
                        }
                        .font(GT.sans(11)).foregroundStyle(GT.textMuted)
                    }
                    .padding(.horizontal, 2)

                    ForEach(Array(parsed.files.enumerated()), id: \.element.id) { index, file in
                        NavigationLink {
                            FileDiffScreen(files: parsed.files, viewed: viewed, index: index)
                        } label: {
                            DiffFileRow(
                                file: file,
                                isViewed: viewed.isViewed(file.path),
                                toggle: { viewed.toggle(file.path) })
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(14)
        }
    }
}

private struct DiffFileRow: View {
    let file: DiffFileModel
    let isViewed: Bool
    let toggle: () -> Void

    var body: some View {
        GTPanel(padding: 10) {
            HStack(spacing: 10) {
                Button(action: toggle) {
                    Image(systemName: isViewed ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 17))
                        .foregroundStyle(isViewed ? GT.accent : GT.textFaint)
                }
                .buttonStyle(.borderless)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.name)
                        .font(GT.mono(12, .medium))
                        .foregroundStyle(isViewed ? GT.textMuted : GT.text)
                        .strikethrough(isViewed, color: GT.textMuted)
                        .lineLimit(1)
                    if !file.directory.isEmpty {
                        Text(file.directory)
                            .font(GT.mono(10)).foregroundStyle(GT.textFaint).lineLimit(1)
                    }
                    if let badge {
                        pill(badge.0, tint: badge.1)
                    }
                }
                Spacer(minLength: 4)
                if !file.isBinary {
                    Text("+\(file.additions)").font(GT.mono(11)).foregroundStyle(GT.green)
                    Text("−\(file.deletions)").font(GT.mono(11)).foregroundStyle(GT.red)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11)).foregroundStyle(GT.textFaint)
            }
        }
    }

    private var badge: (String, Color)? {
        if file.isBinary { return ("binary", GT.textMuted) }
        if file.isNew { return ("new", GT.green) }
        if file.isDeleted { return ("deleted", GT.red) }
        if file.isRename { return ("renamed", GT.blue) }
        return nil
    }
}

// ---- screen 2: one file's diff -------------------------------------------

struct FileDiffScreen: View {
    let files: [DiffFileModel]
    let viewed: ViewedStore
    @State var index: Int

    private var file: DiffFileModel { files[index] }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    header
                    if file.isBinary {
                        GTPanel {
                            Text("Binary file — no textual diff.")
                                .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    } else if file.hunks.isEmpty {
                        GTPanel {
                            Text(file.isRename
                                ? "Renamed with no content changes."
                                : "No content changes (mode change only).")
                                .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    } else {
                        ForEach(file.hunks) { HunkView(hunk: $0) }
                    }
                }
                .padding(12)
            }
            .id(index)  // fresh scroll position when stepping to another file
        }
        .navigationTitle(file.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    viewed.toggle(file.path)
                } label: {
                    Image(systemName: viewed.isViewed(file.path)
                        ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(viewed.isViewed(file.path) ? GT.accent : GT.textMuted)
                }
                Button { index -= 1 } label: { Image(systemName: "chevron.up") }
                    .disabled(index == 0)
                Button { index += 1 } label: { Image(systemName: "chevron.down") }
                    .disabled(index == files.count - 1)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            if file.isRename {
                Text("\(file.fromPath) →").font(GT.mono(10)).foregroundStyle(GT.textFaint)
            }
            HStack(spacing: 8) {
                Text(file.path).font(GT.mono(11)).foregroundStyle(GT.textSoft).lineLimit(1)
                Spacer(minLength: 4)
                Text("+\(file.additions)").font(GT.mono(11)).foregroundStyle(GT.green)
                Text("−\(file.deletions)").font(GT.mono(11)).foregroundStyle(GT.red)
                Text("\(index + 1)/\(files.count)")
                    .font(GT.mono(10)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

private struct HunkView: View {
    let hunk: DiffHunk
    @State private var expanded = false

    /// Very large hunks render this many lines until expanded.
    private static let cap = 400

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(hunk.header)
                .font(GT.mono(10))
                .foregroundStyle(GT.accentLight)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(GT.accent.opacity(0.12))
                .clipShape(Capsule())

            ScrollView(.horizontal, showsIndicators: false) {
                // Uniform text width so add/del backgrounds form solid full-
                // width stripes instead of hugging each line's own length.
                let textWidth = Self.textWidth(for: shownLines)
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(shownLines) { DiffLineRow(line: $0, textWidth: textWidth) }
                }
                .padding(.vertical, 6)
            }
            .background(GT.codeBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            if hunk.lines.count > Self.cap && !expanded {
                Button {
                    expanded = true
                } label: {
                    Text("Show all \(hunk.lines.count) lines")
                        .font(GT.sans(11, .medium)).foregroundStyle(GT.accentLight)
                }
                .buttonStyle(.borderless)
                .padding(.horizontal, 2)
            }
        }
    }

    private var shownLines: [DiffLine] {
        expanded || hunk.lines.count <= Self.cap
            ? hunk.lines
            : Array(hunk.lines.prefix(Self.cap))
    }

    /// One advance of the mono face at the diff's point size — mono means
    /// `chars × advance` is the exact rendered width for ASCII content.
    private static let charWidth: CGFloat = {
        let font = UIFont(name: "IBMPlexMono", size: 11)
            ?? .monospacedSystemFont(ofSize: 11, weight: .regular)
        return ("0" as NSString).size(withAttributes: [.font: font]).width
    }()

    private static func textWidth(for lines: [DiffLine]) -> CGFloat {
        let maxChars = lines.reduce(1) { max($0, $1.text.count) }
        return CGFloat(maxChars) * charWidth + 2
    }
}

private struct DiffLineRow: View {
    let line: DiffLine
    let textWidth: CGFloat

    var body: some View {
        HStack(spacing: 0) {
            Text(line.oldLine.map(String.init) ?? "")
                .font(GT.mono(9)).foregroundStyle(GT.textFaint)
                .frame(width: 34, alignment: .trailing)
            Text(line.newLine.map(String.init) ?? "")
                .font(GT.mono(9)).foregroundStyle(GT.textFaint)
                .frame(width: 34, alignment: .trailing)
            Text(prefix)
                .font(GT.mono(11)).foregroundStyle(tint)
                .frame(width: 16, alignment: .center)
            Text(line.text.isEmpty ? " " : line.text)
                .font(GT.mono(11))
                .foregroundStyle(tint)
                .textSelection(.enabled)
                .frame(minWidth: textWidth, alignment: .leading)
                .padding(.trailing, 10)
        }
        .padding(.vertical, 0.5)
        .background(background)
    }

    private var prefix: String {
        switch line.kind {
        case .add: return "+"
        case .del: return "−"
        case .context: return " "
        }
    }

    private var tint: Color {
        switch line.kind {
        case .add: return GT.green
        case .del: return GT.red
        case .context: return GT.textSoft
        }
    }

    private var background: Color {
        switch line.kind {
        case .add: return GT.green.opacity(0.13)
        case .del: return GT.red.opacity(0.13)
        case .context: return .clear
        }
    }
}
