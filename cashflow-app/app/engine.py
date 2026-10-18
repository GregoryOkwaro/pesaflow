"""Cash-flow projection engine.

A faithful port of the GFSN monthly cash flow budget workbook (Sheet1):

* Opening balance  = sum of account balances flagged "include in total"
                     (workbook: =B34+D34+F34).
* Effective amount = 0 when the item is marked done, else its amount
                     (workbook column N: =IF(K="Y",0,C)).
* Effective date   = workbook column O, with the "tie Dr to Cr" rule as the
                     cell comment describes it: a debit tied to a credit
                     never lands before that credit.
* Occurrences      = effective date, then every N days (workbook rows 2-33).
                     Blank/0 interval means a one-off. Nothing after END DATE.
* Each day         = sum of the occurrences on that day (column AW), and the
                     running balance (column AX).

Money is handled in integer cents throughout to avoid float drift.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable


@dataclass
class Account:
    id: int
    name: str
    balance: int  # cents
    include_in_total: bool = True


@dataclass
class Item:
    id: int
    name: str
    amount: int  # cents, +inflow / -outflow
    every_days: int = 0
    value_date: date | None = None
    end_date: date | None = None
    tie_to: int | None = None  # id of the credit item this debit waits for
    done: bool = False
    account_id: int | None = None


@dataclass
class DayRow:
    date: date
    flows: dict[int, int] = field(default_factory=dict)  # item id -> cents
    net: int = 0
    balance: int = 0


@dataclass
class Projection:
    today: date
    horizon: int
    opening_balance: int
    days: list[DayRow]
    effective_dates: dict[int, date]
    total_in: int
    total_out: int
    closing_balance: int
    lowest_balance: int
    lowest_date: date
    first_negative_date: date | None
    account_closing: dict[int | None, int]

    @property
    def net_flow(self) -> int:
        return self.total_in + self.total_out


def effective_amount(item: Item) -> int:
    return 0 if item.done else item.amount


def effective_date(item: Item, today: date, by_id: dict[int, Item]) -> date:
    """Workbook column O.

    Done items keep their date (capped at today). Otherwise an overdue item is
    due today, and a tied debit moves out to its credit's date if that is later.
    """
    own = item.value_date
    if item.done:
        if own is None or own > today:
            return today
        return own
    base = own
    tied = by_id.get(item.tie_to) if item.tie_to else None
    if tied is not None and tied.value_date is not None:
        base = tied.value_date if base is None else max(base, tied.value_date)
    if base is None or base < today:
        return today
    return base


def occurrences(start: date, every_days: int, last: date, end_date: date | None) -> Iterable[date]:
    stop = min(last, end_date) if end_date else last
    d = start
    while d <= stop:
        yield d
        if every_days <= 0:
            return
        d += timedelta(days=every_days)


def project(accounts: list[Account], items: list[Item], today: date, horizon: int = 31) -> Projection:
    horizon = max(1, int(horizon))
    last = today + timedelta(days=horizon - 1)
    by_id = {i.id: i for i in items}

    days = [DayRow(date=today + timedelta(days=n)) for n in range(horizon)]
    index = {row.date: row for row in days}
    eff_dates: dict[int, date] = {}
    opening = sum(a.balance for a in accounts if a.include_in_total)
    account_closing: dict[int | None, int] = {a.id: a.balance for a in accounts}
    account_closing.setdefault(None, 0)

    total_in = total_out = 0
    for item in items:
        start = effective_date(item, today, by_id)
        eff_dates[item.id] = start
        amt = effective_amount(item)
        for d in occurrences(start, item.every_days or 0, last, item.end_date):
            row = index.get(d)
            if row is None:
                continue
            row.flows[item.id] = amt
            row.net += amt
            if amt > 0:
                total_in += amt
            else:
                total_out += amt
            key = item.account_id if item.account_id in account_closing else None
            account_closing[key] += amt

    bal = opening
    lowest, lowest_date, first_neg = None, today, None
    for row in days:
        bal += row.net
        row.balance = bal
        if lowest is None or bal < lowest:
            lowest, lowest_date = bal, row.date
        if bal < 0 and first_neg is None:
            first_neg = row.date

    return Projection(
        today=today,
        horizon=horizon,
        opening_balance=opening,
        days=days,
        effective_dates=eff_dates,
        total_in=total_in,
        total_out=total_out,
        closing_balance=bal,
        lowest_balance=lowest if lowest is not None else opening,
        lowest_date=lowest_date,
        first_negative_date=first_neg,
        account_closing=account_closing,
    )
