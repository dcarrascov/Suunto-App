"""Tests de la mezcla de actividades de Suunto y de ficheros FIT (python -m unittest discover -s fetch)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge import drop_duplicates, is_same_activity  # noqa: E402


def act(start: str, duration: int, **extra) -> dict:
    return {"startTime": start, "duration": duration, **extra}


class MergeTest(unittest.TestCase):
    def test_misma_sesion(self):
        cloud = act("2026-10-20T08:00:00", 3000)
        self.assertTrue(is_same_activity(cloud, act("2026-10-20T08:01:30", 2950)))   # 90 s y 2 % de diferencia
        self.assertFalse(is_same_activity(cloud, act("2026-10-20T08:03:00", 3000)))  # 3 min: otra sesión
        self.assertFalse(is_same_activity(cloud, act("2026-10-20T08:00:30", 1200)))  # mismo inicio, otra duración

    def test_suma_solo_las_nuevas(self):
        cloud = [act("2026-10-20T08:00:00", 3000), act("2026-10-22T19:00:00", 2400)]
        fit = [
            act("2026-10-20T08:00:05", 3010, sourceFile="a.fit"),   # ya está en Suunto
            act("2026-10-21T07:30:00", 1800, sourceFile="b.fit"),   # nueva (otro reloj)
            act("2026-10-22T19:10:00", 2400, sourceFile="c.fit"),   # 10 min después: es otra
        ]
        kept, repeated = drop_duplicates(cloud, fit)
        self.assertEqual([s["sourceFile"] for s in kept], ["b.fit", "c.fit"])
        self.assertEqual(repeated, 1)

    def test_sin_nube_se_queda_todo(self):
        fit = [act("2026-10-21T07:30:00", 1800)]
        self.assertEqual(drop_duplicates([], fit), (fit, 0))


if __name__ == "__main__":
    unittest.main()
