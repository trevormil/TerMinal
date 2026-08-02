import Foundation

/// Inbox categories on the phone (ticket 121 slice 2).
///
/// A faithful port of `src/shared/inbox-categories.ts`. Swift cannot import the
/// TypeScript, so this is the one place the rules exist twice — and the repo has
/// already paid for that shape twice (two divergent `fmtUsd` copies, a tab strip
/// that drifted until it had to be extracted). The mitigation is that
/// `InboxCategoriesTests` mirrors the TypeScript suite case for case: if one
/// side's behaviour moves, the other side's tests are the thing that notices.
///
/// The load-bearing property, same as desktop: categories are DERIVED from the
/// items present, never a fixed list. A caller names one by passing it to
/// `fileHitl`; nothing here needs editing for a new one to appear.
enum InboxCategories {
    /// Where uncategorised items live. Not a magic string at any call site.
    static let uncategorized = "Uncategorized"

    /// The pseudo-category that selects everything. Always present, always first.
    static let all = "All"

    /// Categories nest with `/`, the way mail folders do: `Monitoring/Certs`.
    /// Parents are synthesised from the paths present, never registered.
    static let sep: Character = "/"

    /// Bounded so a pathological path cannot render a 40-deep tree.
    static let maxDepth = 5

    struct CategoryCount: Equatable, Identifiable, Hashable {
        let name: String
        let count: Int
        var id: String { name }
    }

    /// Validate the SHAPE of a category, not its membership.
    ///
    /// Membership checks are what turn a free string into an enum by the back
    /// door. This only rejects what would break the UI or the file: empty,
    /// absurdly long, or carrying control characters (which a shell-built
    /// `terminal-cli hitl` call can produce by accident).
    static func normalize(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let stripped = raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        let clean = String(String.UnicodeScalarView(stripped))
        // Split on the separator FIRST, then clean each segment.
        // `/Monitoring//Certs/` is what a shell-built `terminal-cli hitl` call
        // actually produces, and empty segments would render as blank rows.
        let segments = clean
            .split(separator: sep, omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(maxDepth)
            // Capped per SEGMENT, not per path: the cap bounds one row's width,
            // and only the leaf is ever drawn.
            .map { String($0.prefix(40)) }
        if segments.isEmpty { return nil }
        return segments.joined(separator: String(sep))
    }

    /// The category an item belongs to — its own, or the residue bucket.
    static func bucket(_ raw: String?) -> String { normalize(raw) ?? uncategorized }

    /// Every ancestor of a path, outermost first: `A/B/C` → `["A", "A/B"]`.
    static func ancestors(of name: String) -> [String] {
        if name == all || name == uncategorized { return [] }
        let parts = name.split(separator: sep).map(String.init)
        guard parts.count > 1 else { return [] }
        return (1..<parts.count).map { parts[0..<$0].joined(separator: String(sep)) }
    }

    /// How deep a category sits: `Monitoring` → 0, `Monitoring/Certs` → 1.
    static func depth(of name: String) -> Int {
        if name == all || name == uncategorized { return 0 }
        return name.split(separator: sep).count - 1
    }

    /// The last segment — what a row shows, since the indent says the parent.
    static func leaf(of name: String) -> String {
        if name == all || name == uncategorized { return name }
        return name.split(separator: sep).last.map(String.init) ?? name
    }

    /// All, then every category present, with counts.
    ///
    /// Sorted by name rather than by count. A list that reorders itself as items
    /// arrive makes the entry you were about to tap move under your thumb —
    /// counts change constantly, names do not. On a phone that is a mis-tap, not
    /// just an annoyance.
    ///
    /// `Uncategorized` sorts last regardless: it is a residue bucket, not a
    /// peer, and most existing items land in it until callers pass a category.
    static func derive(_ items: [HitlItem]) -> [CategoryCount] {
        var counts: [String: Int] = [:]
        for item in items {
            let name = bucket(item.category)
            counts[name, default: 0] += 1
            // Every ancestor gets the item too, so a parent's count means "what
            // selecting this row will show me". A parent reading 0 beside
            // children reading 3 looks like a bug, and the parent is selectable.
            for ancestor in ancestors(of: name) { counts[ancestor, default: 0] += 1 }
        }

        // `localeCompare` on the TypeScript side; `.compare` with no options is
        // its closest equivalent and agrees for the ASCII names in practice.
        let named = counts
            .filter { $0.key != uncategorized }
            .sorted { $0.key.compare($1.key) == .orderedAscending }
            .map { CategoryCount(name: $0.key, count: $0.value) }

        var out = [CategoryCount(name: all, count: items.count)]
        out.append(contentsOf: named)
        if let residue = counts[uncategorized] {
            out.append(CategoryCount(name: uncategorized, count: residue))
        }
        return out
    }

    /// Should the filter control render at all?
    ///
    /// With one real category there is nothing to choose between, and a control
    /// offering "All (12)" and "Uncategorized (12)" is chrome that says nothing.
    /// Absent beats empty — more so here, where it costs a row of a small screen.
    static func shouldShowFilter(_ categories: [CategoryCount]) -> Bool {
        categories.filter { $0.name != all }.count > 1
    }

    /// Resolve the selected category against what actually exists.
    ///
    /// Selection is persisted, so the category it names can disappear between
    /// launches — the last monitoring alert gets resolved and `Monitoring` is
    /// gone. Without this the Inbox opens filtered to nothing and reads as
    /// broken, which on a phone looks like a sync failure.
    static func resolveSelection(_ selected: String?, _ categories: [CategoryCount]) -> String {
        guard let selected, !selected.isEmpty else { return all }
        return categories.contains { $0.name == selected } ? selected : all
    }

    /// Filter items by the resolved selection. `All` is not a filter.
    ///
    /// Selecting a parent includes everything beneath it — otherwise a parent
    /// with only children selects to nothing and the row just tapped reads as
    /// broken.
    ///
    /// Matching is on SEGMENT boundaries, not string prefixes: a naive
    /// `hasPrefix(selected)` makes `Build` select `Builds`, which is a silent
    /// wrong answer rather than a visible failure.
    static func filter(_ items: [HitlItem], _ selected: String) -> [HitlItem] {
        if selected == all { return items }
        let prefix = selected + String(sep)
        return items.filter {
            let name = bucket($0.category)
            return name == selected || name.hasPrefix(prefix)
        }
    }

    /// What a bulk "Read all" is allowed to touch: the unread items IN THE
    /// CURRENT VIEW.
    ///
    /// This is a named function rather than an expression inlined into the view
    /// model because it is the whole bug. The desktop shipped the unscoped
    /// version and smoke testing caught it: with a category selected, "Read all"
    /// silently cleared unread state for items the user could not see and had
    /// never been shown. A bulk action whose blast radius exceeds the filter is
    /// destroying invisible state.
    ///
    /// As a unit it is directly testable; inlined it would be reachable only
    /// through a live feed, which is exactly how the desktop version shipped
    /// untested.
    static func bulkReadTargets(_ items: [HitlItem], _ selected: String) -> [HitlItem] {
        filter(items, selected).filter(\.isUnread)
    }
}
