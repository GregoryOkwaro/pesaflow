"""The engine must reproduce the original workbook's numbers.

Fixture: the GFSN workbook as calculated on 16 Oct 2026, with item names
anonymised. Expected values are the workbook's cached AW (day's net flow)
and AX (cumulative balance) columns.
"""
import unittest
from datetime import date, timedelta

from app.engine import Account, Item, effective_date, project

TODAY = date(2026, 10, 16)
X = lambda serial: date(1899, 12, 30) + timedelta(days=serial)  # Excel serial -> date  # noqa: E731

ACCOUNTS = [Account(1, "M", -165200), Account(2, "E", 926700), Account(3, "O", 2267700)]

# (id, amount KES, every days, value date serial, end date serial, tie_to, done)
ROWS = [
    (36, 35000, 0, 46313, None, None, False),   # income
    (37, 0, 0, 46300, None, None, False),       # "PAID ..." text in the sheet
    (38, -500, 2, 46313, None, None, False),
    (39, -1750, 3, 46311, None, None, False),
    (40, 0, 0, 46300, None, None, False),
    (41, 0, 0, 46311, None, None, False),
    (42, 0, 0, 46300, None, None, False),
    (43, 0, 0, None, None, None, False),
    (44, -5000, 2, 46308, 46314, None, False),  # overdue, recurring, with end date
    (45, 0, 0, 46294, None, None, False),
    (46, 0, 0, 46301, None, None, False),
    (47, 0, 0, 46297, None, None, False),
    (48, 0, 0, 46311, None, None, False),
    (49, 0, 0, 46301, None, None, False),
    (50, -90000, 0, 46313, None, None, False),
    (51, 0, 0, 46300, None, None, False),
    (52, 0, 0, 46297, None, None, False),
    (53, 0, 0, 46280, None, None, False),
    (54, 0, 0, 46280, None, None, False),
    (55, 0, 0, 46290, None, None, False),
    (56, 0, 0, 46277, None, None, False),
    (57, 0, 0, 46315, None, 36, False),         # tied to the income item
    (58, 0, 0, None, None, None, False),
    (59, 0, 0, 46300, None, None, False),
    (60, 0, 0, 46311, None, None, False),
]

EXPECTED_NET = [-6750, 0, -60500, -1750, -500, 0, -2250, 0, -500, -1750, -500, 0, -2250, 0, -500, -1750,
                -500, 0, -2250, 0, -500, -1750, -500, 0, -2250, 0, -500, -1750, -500, 0, -2250]
EXPECTED_BAL = [23542, 23542, -36958, -38708, -39208, -39208, -41458, -41458, -41958, -43708, -44208,
                -44208, -46458, -46458, -46958, -48708, -49208, -49208, -51458, -51458, -51958, -53708,
                -54208, -54208, -56458, -56458, -56958, -58708, -59208, -59208, -61458]


def items():
    return [Item(i, f"Item {i}", amt * 100, every, X(vd) if vd else None, X(ed) if ed else None, tie, done)
            for i, amt, every, vd, ed, tie, done in ROWS]


class WorkbookParity(unittest.TestCase):
    def test_matches_workbook_day_by_day(self):
        p = project(ACCOUNTS, items(), TODAY, 31)
        self.assertEqual(p.opening_balance, 3029200)
        self.assertEqual([d.net // 100 for d in p.days], EXPECTED_NET)
        self.assertEqual([d.balance // 100 for d in p.days], EXPECTED_BAL)
        self.assertEqual(p.closing_balance, -6145800)
        self.assertEqual(p.first_negative_date, X(46313))


class Rules(unittest.TestCase):
    def test_done_item_contributes_nothing(self):
        p = project([Account(1, "A", 0)], [Item(1, "x", -100, value_date=TODAY, done=True)], TODAY, 5)
        self.assertEqual(p.closing_balance, 0)

    def test_overdue_and_blank_dates_fall_due_today(self):
        by_id = {}
        self.assertEqual(effective_date(Item(1, "x", -1, value_date=TODAY - timedelta(days=9)), TODAY, by_id), TODAY)
        self.assertEqual(effective_date(Item(2, "x", -1), TODAY, by_id), TODAY)

    def test_tied_debit_waits_for_credit(self):
        credit = Item(1, "salary", 1000, value_date=TODAY + timedelta(days=5))
        debit = Item(2, "rent", -500, value_date=TODAY + timedelta(days=1), tie_to=1)
        self.assertEqual(effective_date(debit, TODAY, {1: credit, 2: debit}), credit.value_date)
        later = Item(3, "fees", -500, value_date=TODAY + timedelta(days=9), tie_to=1)
        self.assertEqual(effective_date(later, TODAY, {1: credit, 3: later}), later.value_date)

    def test_end_date_stops_recurrence(self):
        it = Item(1, "x", -100, every_days=1, value_date=TODAY, end_date=TODAY + timedelta(days=2))
        p = project([], [it], TODAY, 10)
        self.assertEqual(p.total_out, -300)

    def test_excluded_account_not_in_opening(self):
        p = project([Account(1, "Cash", 500), Account(2, "Savings", 9999, include_in_total=False)], [], TODAY, 3)
        self.assertEqual(p.opening_balance, 500)

    def test_long_horizon_keeps_recurring(self):
        p = project([], [Item(1, "x", -1, every_days=1, value_date=TODAY)], TODAY, 90)
        self.assertEqual(p.total_out, -90)


if __name__ == "__main__":
    unittest.main()
