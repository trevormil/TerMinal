import Foundation

/// Repos you pinned on this phone. The desktop keeps its own pins in renderer
/// localStorage, which the Mac's main process can't read — so rather than show
/// a half-truth, the phone owns its pins and the Mac supplies recency.
enum PinnedReposStore {
    private static let key = "pinnedWorkspaces"

    static func all() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    static func isPinned(_ path: String) -> Bool { all().contains(path) }

    static func toggle(_ path: String) {
        var paths = all()
        if let i = paths.firstIndex(of: path) { paths.remove(at: i) } else { paths.append(path) }
        UserDefaults.standard.set(paths, forKey: key)
    }
}
