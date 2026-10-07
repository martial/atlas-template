"""Source coverage for broad questions and stable, compact citation references."""
import json
import re
from collections import deque
from itertools import zip_longest


def evidence(source, number):
    return {"citation": number, "name": source["name"], "location": source["location"],
            "text": source["text"]}


def source_order(source):
    # Numbered files sort naturally (2 before 10); positions are relative to each file.
    name = tuple((1, int(p)) if p.isdigit() else (0, p) for p in
                 re.split(r"(\d+)", source["name"].casefold()))
    location = source["location"]
    return (name, source["asset"], location.get("page", 0), location.get("start", 0),
            location.get("offset", 0), source["part"])


def spread(values):
    """Visit both ends and then the middle of each interval, rather than only its head."""
    if not values:
        return []
    indices = [0] if len(values) == 1 else [0, len(values) - 1]
    intervals = deque([(1, len(values) - 2)])
    while intervals:
        low, high = intervals.popleft()
        if low <= high:
            middle = (low + high) // 2
            indices.append(middle)
            intervals.extend(((low, middle - 1), (middle + 1, high)))
    return [values[i] for i in indices]


def overview_sources(sources, max_sources=512, max_characters=128000):
    ordered = sorted(sources, key=source_order)
    groups = {}
    for source in ordered:
        groups.setdefault(source["asset"], []).append(source)
    # Give separate files coverage before taking more passages from a long file.
    candidates = zip_longest(*(spread(group) for group in spread(list(groups.values()))))
    selected, characters = [], 2
    for row in candidates:
        for source in row:
            if source is None:
                continue
            cost = len(json.dumps(evidence(source, len(selected) + 1), ensure_ascii=False)) + 2
            if len(selected) >= max_sources or characters + cost > max_characters:
                continue
            selected.append(source)
            characters += cost
    selected.sort(key=source_order)
    return selected, {"mode": "overview", "total_sources": len(sources),
                      "included_sources": len(selected), "limited": len(selected) < len(sources)}


def cited_sources(answer, sources):
    # Accept grouped model references as well as the requested individual [n] form.
    answer = re.sub(r"\[(\d+(?:\s*,\s*\d+)+)\]",
                    lambda m: "".join(f"[{n}]" for n in re.findall(r"\d+", m[1])), answer)
    used = list(dict.fromkeys(int(n) for n in re.findall(r"\[(\d+)\]", answer)
                             if 1 <= int(n) <= len(sources)))
    numbers = {old: new for new, old in enumerate(used, 1)}
    answer = re.sub(r"\[(\d+)\]", lambda m: f"[{numbers[int(m[1])]}]" if int(m[1]) in numbers else "", answer)
    return answer, [sources[i - 1] for i in used]
