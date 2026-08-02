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
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.isEmpty { return nil }
        return String(clean.prefix(40))
    }

    /// The category an item belongs to — its own, or the residue bucket.
    static func bucket(_ raw: String?) -> String { normalize(raw) ?? uncategorized }

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
        for item in items { counts[bucket(item.category), default: 0] += 1 }

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
    static func filter(_ items: [HitlItem], _ selected: String) -> [HitlItem] {
        if selected == all { return items }
        return items.filter { bucket($0.category) == selected }
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
