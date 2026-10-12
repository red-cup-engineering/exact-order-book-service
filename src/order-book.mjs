import { rationalOfBigInts } from "@red-cup-engineering/exact-number-data-service/exact-number";
import { admitGraded, gradeOf, gradedAdd, gradedCompare, gradedQuotient, gradedRatio, gradedScale, gradedSign, gradedSubtract, gradedTimes, gradedZero } from "@red-cup-engineering/exact-number-data-service/graded";


const oneHalf = rationalOfBigInts(1n, 2n);

/** One price level of an order book. */

/** An order book snapshot. Sides may arrive unsorted; the laws sort copies. */

const asBookRecord = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label}: expected an object`);
  }
  return value;
};

const admitLevel = (value, label) => {
  const record = asBookRecord(value, label);
  const keys = Object.keys(record);
  if (keys.length !== 2 || keys.some((key) => key !== "price" && key !== "quantity")) {
    throw new TypeError(`${label}: expected exactly price, quantity`);
  }
  return Object.freeze({
    price: admitGraded(record.price, `${label}.price`),
    quantity: admitGraded(record.quantity, `${label}.quantity`),
  });
};

/** Admit an order-book snapshot from JSON and reconstruct its exact money carriers. */
export function admitOrderBook(value, label = "order book") {
  const record = asBookRecord(value, label);
  const keys = Object.keys(record);
  if (keys.length !== 2 || keys.some((key) => key !== "bids" && key !== "asks")) {
    throw new TypeError(`${label}: expected exactly bids, asks`);
  }
  if (!Array.isArray(record.bids) || !Array.isArray(record.asks)) {
    throw new TypeError(`${label}: bids and asks must be arrays`);
  }
  const book = Object.freeze({
    bids: Object.freeze(record.bids.map((level, index) => admitLevel(level, `${label}.bids[${index}]`))),
    asks: Object.freeze(record.asks.map((level, index) => admitLevel(level, `${label}.asks[${index}]`))),
  });
  assertBookCoherent(book);
  return book;
}

function assertSideCoherent(side, label) {
  const first = side[0];
  if (first === undefined) return;
  for (const level of side) {
    if (gradeOf(level.price) !== gradeOf(first.price)) {
      throw new TypeError(`order-book: mixed price commodities in ${label}`);
    }
    if (gradeOf(level.quantity) !== gradeOf(first.quantity)) {
      throw new TypeError(`order-book: mixed quantity commodities in ${label}`);
    }
    if (gradedSign(level.quantity) < 0 || gradedSign(level.price) < 0) {
      throw new RangeError(`order-book: negative price or quantity in ${label}`);
    }
  }
}

function assertBookCoherent(book) {
  assertSideCoherent(book.bids, "bids");
  assertSideCoherent(book.asks, "asks");
  const bid = book.bids[0];
  const ask = book.asks[0];
  if (bid === undefined || ask === undefined) return;
  if (gradeOf(bid.price) !== gradeOf(ask.price)) {
    throw new TypeError("order-book: bid and ask price commodities differ");
  }
  if (gradeOf(bid.quantity) !== gradeOf(ask.quantity)) {
    throw new TypeError("order-book: bid and ask quantity commodities differ");
  }
}

function sortedAsks(book) {
  assertSideCoherent(book.asks, "asks");
  return [...book.asks].sort((a, b) => gradedCompare(a.price, b.price));
}

function sortedBids(book) {
  assertSideCoherent(book.bids, "bids");
  return [...book.bids].sort((a, b) => gradedCompare(b.price, a.price));
}

/** The highest bid level, if any. */
export function bestBid(book) {
  return sortedBids(book)[0];
}

/** The lowest ask level, if any. */
export function bestAsk(book) {
  return sortedAsks(book)[0];
}

/** Exact spread, best ask minus best bid, absent when either side is empty. */
export function spread(book) {
  const bid = bestBid(book);
  const ask = bestAsk(book);
  if (bid === undefined || ask === undefined) return undefined;
  return gradedSubtract(ask.price, bid.price);
}

/** Exact midpoint, average of best bid and best ask. */
export function midpoint(book) {
  const bid = bestBid(book);
  const ask = bestAsk(book);
  if (bid === undefined || ask === undefined) return undefined;
  return gradedScale(gradedAdd(bid.price, ask.price), oneHalf);
}

/** Spread over midpoint as a dimensionless exact ratio. */
export function relativeSpread(book) {
  const s = spread(book);
  const m = midpoint(book);
  if (s === undefined || m === undefined) return undefined;
  if (gradedSign(m) === 0) return undefined;
  return gradedRatio(s, m);
}

/** The outcome of walking one side of a book with a marketable order: what filled, the shortfall the
 *  book could not fill, the cost (quantity × price summed exactly), the average price, the worst
 *  price reached and how many levels were taken. */

function walk(levels, baseQuantity) {
  if (gradedSign(baseQuantity) < 0) {
    throw new RangeError("order-book: negative walk quantity");
  }
  const first = levels[0];
  const baseCommodity = gradeOf(baseQuantity);
  const quoteCommodity = first === undefined ? baseCommodity : gradeOf(first.price);
  let remaining = baseQuantity;
  let filled = gradedZero(baseCommodity);
  let cost = gradedZero(quoteCommodity);
  let worst;
  let taken = 0;
  for (const level of levels) {
    if (gradedSign(remaining) === 0) break;
    if (gradeOf(level.quantity) !== baseCommodity) {
      throw new TypeError(
        `order-book: walk quantity commodity ${baseCommodity} does not match book base ${gradeOf(level.quantity)}`,
      );
    }
    const take = gradedCompare(remaining, level.quantity) <= 0 ? remaining : level.quantity;
    filled = gradedAdd(filled, take);
    cost = gradedAdd(cost, gradedTimes(level.price, take, gradeOf(level.price)));
    remaining = gradedSubtract(remaining, take);
    if (gradedSign(take) > 0) { worst = level.price; taken += 1; }
  }
  const averagePrice = gradedSign(filled) === 0
    ? undefined
    : gradedQuotient(cost, filled, gradeOf(cost));
  return Object.freeze({
    filled,
    cost,
    shortfall: remaining,
    ...(averagePrice !== undefined ? { averagePrice } : {}),
    ...(worst !== undefined ? { worst } : {}),
    levels: taken,
  });
}

/** Walk the asks with a market buy of `baseQuantity`. */
export function marketBuyWalk(book, baseQuantity) {
  return walk(sortedAsks(book), baseQuantity);
}

/** Walk the bids with a market sell of `baseQuantity`. */
export function marketSellWalk(book, baseQuantity) {
  return walk(sortedBids(book), baseQuantity);
}


