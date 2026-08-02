import XCTest
@testable import TerMinalRemote

/// Mirrors `src/shared/inbox-categories.test.ts` case for case.
///
/// Swift cannot import the TypeScript, so the rules exist twice — and this file
/// is the mitigation. Each test below corresponds to one in the TypeScript
/// suite; if either platform's behaviour moves, the other's tests are what
/// notices. Keeping the names parallel is deliberate, so a diff of the two
/// files is readable.
final class InboxCategoriesTests: XCTestCase {
    private func item(_ id: String, category: String? = nil, unread: Bool = true) -> HitlItem {
        HitlItem(
            id: id, title: id, detail: nil, action: nil, repo: nil, source: "test",
            createdAt: 0, severity: "normal", status: "open",
            readAt: unread ? nil : 1, category: category)
    }

    // MARK: a brand-new category needs no code change

    func testANameNobodyHasEverUsedAppearsWithItsCount() {
        // The load-bearing property: no registry, no union, no UI edit. If this
        // ever needs a code change to pass, the feature has become an enum.
        let cats = InboxCategories.derive([
            item("a", category: "Peculiar New Thing"),
            item("b", category: "Peculiar New Thing"),
        ])
        XCTAssertEqual(cats.map(\.name), ["All", "Peculiar New Thing"])
        XCTAssertEqual(cats.last?.count, 2)
    }

    func testAllCountsEveryItemIncludingUncategorisedOnes() {
        let cats = InboxCategories.derive([
            item("a", category: "Monitoring"), item("b"), item("c"),
        ])
        XCTAssertEqual(cats.first?.name, "All")
        XCTAssertEqual(cats.first?.count, 3)
    }

    // MARK: ordering is stable under churn

    func testSortedByNameNotByCount() {
        // Counts change constantly; names do not. A list that reorders as items
        // arrive moves the row out from under a thumb already on its way down.
        let cats = InboxCategories.derive([
            item("a", category: "Zebra"), item("b", category: "Zebra"),
            item("c", category: "Zebra"), item("d", category: "Alpha"),
        ])
        XCTAssertEqual(cats.map(\.name), ["All", "Alpha", "Zebra"])
    }

    func testUncategorizedSortsLastNotAlphabetically() {
        let cats = InboxCategories.derive([item("a"), item("b", category: "Zebra")])
        XCTAssertEqual(cats.map(\.name), ["All", "Zebra", "Uncategorized"])
    }

    func testUncategorizedIsAbsentWhenEverythingIsCategorised() {
        let cats = InboxCategories.derive([item("a", category: "Monitoring")])
        XCTAssertFalse(cats.contains { $0.name == "Uncategorized" })
    }

    // MARK: shape is validated, membership is not

    func testOrdinaryNamesPassThrough() {
        XCTAssertEqual(InboxCategories.normalize("Monitoring"), "Monitoring")
        // Spaces survive. The control-character strip must not take them with it.
        XCTAssertEqual(InboxCategories.normalize("Monitoring alert"), "Monitoring alert")
    }

    func testEmptyAndMissingBecomeNilWhichMeansUncategorized() {
        XCTAssertNil(InboxCategories.normalize(nil))
        XCTAssertNil(InboxCategories.normalize(""))
        XCTAssertNil(InboxCategories.normalize("   "))
        XCTAssertEqual(InboxCategories.bucket(nil), "Uncategorized")
    }

    func testControlCharactersAreStripped() {
        // A shell-built `terminal-cli hitl` call emits these by accident.
        XCTAssertEqual(InboxCategories.normalize("Mon\u{0}itor\u{1b}ing"), "Monitoring")
        XCTAssertEqual(InboxCategories.normalize("Monitoring\n"), "Monitoring")
        XCTAssertEqual(InboxCategories.normalize("\u{7f}"), nil)
    }

    func testAbsurdLengthsAreBoundedNotRejected() {
        // Bounded, not rejected — a too-long name is a caller being sloppy, not
        // a reason to lose the item's category entirely.
        let long = String(repeating: "x", count: 200)
        XCTAssertEqual(InboxCategories.normalize(long)?.count, 40)
    }

    func testItDoesNotCheckMembershipAgainstAKnownList() {
        // The regression this guards: someone "tidies up" by validating against
        // the categories currently in use, and the feature quietly becomes the
        // closed union it was written to avoid.
        for name in ["Monitoring", "🙂", "x", "Not A Real Category At All"] {
            XCTAssertNotNil(InboxCategories.normalize(name), "\(name) should pass shape validation")
        }
    }

    // MARK: the filter earns its space

    func testHiddenWhenThereIsNothingToChooseBetween() {
        XCTAssertFalse(InboxCategories.shouldShowFilter(InboxCategories.derive([])))
        // All + Uncategorized only: nothing to choose between.
        XCTAssertFalse(InboxCategories.shouldShowFilter(
            InboxCategories.derive([item("a"), item("b")])))
        // All + one real category: same.
        XCTAssertFalse(InboxCategories.shouldShowFilter(
            InboxCategories.derive([item("a", category: "Monitoring")])))
    }

    func testShownAsSoonAsThereIsARealChoice() {
        XCTAssertTrue(InboxCategories.shouldShowFilter(
            InboxCategories.derive([item("a", category: "Monitoring"), item("b")])))
    }

    // MARK: a persisted selection survives its category disappearing

    func testAStillPresentSelectionIsKept() {
        let cats = InboxCategories.derive([item("a", category: "Monitoring"), item("b")])
        XCTAssertEqual(InboxCategories.resolveSelection("Monitoring", cats), "Monitoring")
    }

    func testAVanishedSelectionFallsBackToAll() {
        // The last monitoring alert gets resolved and the category is gone.
        // Without this the Inbox opens filtered to nothing and reads as a sync
        // failure — worse on a phone, where pull-to-refresh is the instinct and
        // it will not help.
        let cats = InboxCategories.derive([item("a", category: "Builds")])
        XCTAssertEqual(InboxCategories.resolveSelection("Monitoring", cats), "All")
    }

    func testNoSelectionIsAll() {
        let cats = InboxCategories.derive([item("a", category: "Builds")])
        XCTAssertEqual(InboxCategories.resolveSelection(nil, cats), "All")
        XCTAssertEqual(InboxCategories.resolveSelection("", cats), "All")
    }

    // MARK: filtering

    func testAllIsNotAFilter() {
        let items = [item("a", category: "Monitoring"), item("b")]
        XCTAssertEqual(InboxCategories.filter(items, "All").map(\.id), ["a", "b"])
    }

    func testANamedCategorySelectsOnlyItsOwn() {
        let items = [item("a", category: "Monitoring"), item("b", category: "Builds"), item("c")]
        XCTAssertEqual(InboxCategories.filter(items, "Monitoring").map(\.id), ["a"])
    }

    func testUncategorizedSelectsTheOnesWithNoCategory() {
        let items = [item("a", category: "Monitoring"), item("b"), item("c", category: "  ")]
        // "  " normalises away, so it belongs in the residue bucket too.
        XCTAssertEqual(InboxCategories.filter(items, "Uncategorized").map(\.id), ["b", "c"])
    }

    func testUncategorisedItemsAreStillInAll() {
        // The bucket must not hide them — it is a label, not an archive.
        let items = [item("a", category: "Monitoring"), item("b")]
        XCTAssertEqual(InboxCategories.filter(items, "All").count, 2)
    }

    // MARK: a bulk action cannot reach past the filter

    func testReadAllTouchesOnlyTheVisibleCategory() {
        // The exact desktop bug, as a test. With Monitoring selected, a
        // "Read all" that returns the Builds item is clearing unread state the
        // user cannot see and was never shown.
        let items = [
            item("mon-unread", category: "Monitoring"),
            item("mon-read", category: "Monitoring", unread: false),
            item("build-unread", category: "Builds"),
            item("none-unread"),
        ]
        XCTAssertEqual(
            InboxCategories.bulkReadTargets(items, "Monitoring").map(\.id),
            ["mon-unread"])
    }

    func testReadAllUnderAllStillTouchesEverythingUnread() {
        // Scoping must not overcorrect into "never marks anything".
        let items = [
            item("a", category: "Monitoring"),
            item("b", category: "Builds"),
            item("c", unread: false),
        ]
        XCTAssertEqual(InboxCategories.bulkReadTargets(items, "All").map(\.id), ["a", "b"])
    }

    func testReadAllUnderUncategorizedSkipsCategorisedItems() {
        let items = [item("a", category: "Monitoring"), item("b"), item("c")]
        XCTAssertEqual(
            InboxCategories.bulkReadTargets(items, "Uncategorized").map(\.id), ["b", "c"])
    }

    // MARK: the model wires it up (ticket 121)

    func testMarkedReadPreservesTheCategory() {
        // The trap this exists for: the copy helpers used to enumerate fields
        // by hand, so a newly-added one was silently dropped. That would have
        // made an optimistic mark-read yank the item out of its own category
        // until the next refresh put it back.
        let read = item("a", category: "Monitoring").markedRead()
        XCTAssertEqual(read.category, "Monitoring")
        XCTAssertFalse(read.isUnread)

        let unread = read.markedUnread()
        XCTAssertEqual(unread.category, "Monitoring")
        XCTAssertTrue(unread.isUnread)
    }

    func testCategoryDecodesFromTheBridgePayload() {
        // The bridge passes hitl.json rows through untouched, so the field
        // arrives for free — but only if Codable declares it. This is the
        // end-to-end claim: a category filed on the desktop reaches the phone.
        let json = """
        {"id":"x","title":"t","source":"monitor","createdAt":1,"category":"Monitoring"}
        """
        let item = try? JSONDecoder().decode(HitlItem.self, from: Data(json.utf8))
        XCTAssertEqual(item?.category, "Monitoring")

        // And an item filed before the feature existed still decodes.
        let legacy = """
        {"id":"y","title":"t","source":"manual","createdAt":1}
        """
        let old = try? JSONDecoder().decode(HitlItem.self, from: Data(legacy.utf8))
        XCTAssertNotNil(old)
        XCTAssertNil(old?.category)
    }

    // MARK: nesting — mirrors the "categories nest with /" block in the TS suite

    func testAParentAppearsEvenWhenNoItemIsFiledDirectlyInIt() {
        // THE test for nesting. Filing to `Monitoring/Certs` must produce a
        // selectable `Monitoring` row, or the tree has holes.
        let cats = InboxCategories.derive([
            item("a", category: "Monitoring/Certs"),
            item("b", category: "Monitoring/Uptime"),
        ])
        XCTAssertEqual(cats.map(\.name), ["All", "Monitoring", "Monitoring/Certs", "Monitoring/Uptime"])
    }

    func testAParentsCountIncludesItsDescendants() {
        let cats = InboxCategories.derive([
            item("a", category: "Monitoring"),
            item("b", category: "Monitoring/Certs"),
            item("c", category: "Monitoring/Certs/Expiry"),
            item("d", category: "Builds"),
        ])
        let by = { (n: String) in cats.first { $0.name == n }?.count }
        XCTAssertEqual(by("Monitoring"), 3)
        XCTAssertEqual(by("Monitoring/Certs"), 2)
        XCTAssertEqual(by("Builds"), 1)
        XCTAssertEqual(by("All"), 4)
    }

    func testSelectingAParentShowsEverythingBeneathIt() {
        let items = [
            item("a", category: "Monitoring"),
            item("b", category: "Monitoring/Certs"),
            item("c", category: "Monitoring/Certs/Expiry"),
            item("d", category: "Builds"),
        ]
        XCTAssertEqual(InboxCategories.filter(items, "Monitoring").map(\.id), ["a", "b", "c"])
        XCTAssertEqual(InboxCategories.filter(items, "Monitoring/Certs").map(\.id), ["b", "c"])
    }

    func testAPrefixThatIsNotAPathSegmentDoesNotMatch() {
        // The bug a naive hasPrefix() gives you: `Build` selecting `Builds`.
        let items = [
            item("a", category: "Monitoring"),
            item("b", category: "MonitoringOther"),
            item("c", category: "Builds"),
            item("d", category: "Build"),
        ]
        XCTAssertEqual(InboxCategories.filter(items, "Monitoring").map(\.id), ["a"])
        XCTAssertEqual(InboxCategories.filter(items, "Build").map(\.id), ["d"])
    }

    func testSeparatorNoiseIsCleanedRatherThanCreatingEmptyFolders() {
        XCTAssertEqual(InboxCategories.normalize("/Monitoring//Certs/"), "Monitoring/Certs")
        XCTAssertEqual(InboxCategories.normalize("  Monitoring / Certs  "), "Monitoring/Certs")
        XCTAssertNil(InboxCategories.normalize("///"))
    }

    func testDepthIsBoundedAndSegmentsAreCappedIndividually() {
        XCTAssertLessThanOrEqual(
            InboxCategories.normalize("a/b/c/d/e/f/g/h/i/j")?.split(separator: "/").count ?? 0, 5)
        let long = String(repeating: "x", count: 60) + "/" + String(repeating: "y", count: 60)
        for seg in (InboxCategories.normalize(long) ?? "").split(separator: "/") {
            XCTAssertLessThanOrEqual(seg.count, 40)
        }
    }

    func testDepthAndLeafComeOffTheName() {
        XCTAssertEqual(InboxCategories.depth(of: "Monitoring"), 0)
        XCTAssertEqual(InboxCategories.depth(of: "Monitoring/Certs"), 1)
        XCTAssertEqual(InboxCategories.leaf(of: "Monitoring/Certs/Expiry"), "Expiry")
        XCTAssertEqual(InboxCategories.leaf(of: "All"), "All")
        XCTAssertEqual(InboxCategories.depth(of: "Uncategorized"), 0)
    }

    func testFlatCategoriesAreCompletelyUnaffected() {
        // The regression that matters most: every existing item is flat.
        let cats = InboxCategories.derive([
            item("a", category: "Monitoring"), item("b", category: "Builds"), item("c"),
        ])
        XCTAssertEqual(cats.map(\.name), ["All", "Builds", "Monitoring", "Uncategorized"])
    }

    func testBulkReadUnderAParentCoversTheWholeBranch() {
        // Scoping and nesting have to agree: "Read all" under a parent must
        // touch exactly what the parent is showing, no more and no less.
        let items = [
            item("a", category: "Monitoring/Certs"),
            item("b", category: "Monitoring"),
            item("c", category: "Builds"),
        ]
        XCTAssertEqual(
            InboxCategories.bulkReadTargets(items, "Monitoring").map(\.id), ["a", "b"])
    }
}
