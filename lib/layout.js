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
