// How wide a board is, in one place.
//
// Every page centres its content in a container with a maximum width, and the
// three numbers in use had drifted apart: the schedule board, allocation and
// material orders at 1800, costing at 1600, and the other nine at 1500. On
// anything wider than 1500 that meant the whole page jumped sideways when you
// moved between tabs — Material orders to Material list shifted everything by
// a hundred and fifty pixels each side, which is enough to lose your place in
// a table you were reading.
//
// 1800 rather than 1500, because the pages that chose it chose it for a
// reason: the schedule board carries ten process columns and allocation a
// column per machine, and taking three hundred pixels off those to match the
// narrower pages would cost real information to fix a cosmetic problem. The
// pages coming up from 1500 lose nothing — they are tables, and a table fills
// the width it is given. Prose keeps its own cap, because a paragraph 1800
// pixels wide is unreadable however wide the screen is.
//
// Below 1500 none of this binds and every page has always looked the same;
// the jump only ever showed on a wide monitor.
export const PAGE_WIDTH = 1800;

/** The strip a paragraph is allowed to use, whatever the page is doing. */
export const TEXT_WIDTH = 820;

// How tall a page's header is, for the same reason the width is shared.
//
// The header is a flex row — title and subtitle on the left, who you're
// signed in as and the Refresh button on the right — and it was as tall as
// whichever side had more in it. That varied by page: 46 on Costing, which
// has no Refresh; 69 on Stock; 91 on Deliveries, Orders and Tasks, which
// carry an "Updated 2:31 pm" line under the button. So the tab strip started
// at a different height on different boards, and the whole page under it
// stepped up and down as you moved along the row.
//
// A floor rather than a fixed height: 92 clears the tallest of them, and
// anything that grows past it still can. The pages with less in the header
// get a little air instead of pulling everything up.
export const HEADER_HEIGHT = 92;

/**
 * The gap between the header and the tab strip under it.
 *
 * Twenty on eleven pages and sixteen on the schedule board and allocation,
 * which is four pixels of drift nobody would ever spot on one page and
 * everybody feels moving between two.
 */
export const HEADER_GAP = 20;
