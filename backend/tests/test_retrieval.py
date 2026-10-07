import json

from atlas.retrieval import cited_sources, evidence, overview_sources


def source(name, part=1, text="Scene description"):
    return {"asset": name, "name": name, "part": part, "chunk": f"{name}-{part}",
            "location": {"start": part * 20}, "text": text}


def test_overview_includes_all_scenes_in_natural_order_not_retrieval_order():
    rows = [source("Shot 10.mp4"), source("Shot 2.mp4", 2), source("Shot 1.mp4"), source("Shot 2.mp4")]
    selected, coverage = overview_sources(rows)
    assert [s["chunk"] for s in selected] == ["Shot 1.mp4-1", "Shot 2.mp4-1", "Shot 2.mp4-2", "Shot 10.mp4-1"]
    assert coverage == {"mode": "overview", "total_sources": 4, "included_sources": 4, "limited": False}


def test_large_overview_spreads_budget_across_files_and_positions():
    # A long file must not consume the context and exclude the ending or other files.
    rows = [source("Shot 1.mp4", i) for i in range(1, 101)] + [source("Shot 2.mp4"), source("Shot 10.mp4")]
    selected, coverage = overview_sources(rows, max_sources=6)
    assert {s["asset"] for s in selected} == {s["asset"] for s in rows}
    assert {1, 100}.issubset({s["part"] for s in selected if s["asset"] == "Shot 1.mp4"})
    assert len(selected) == 6 and coverage["limited"]
    selected, coverage = overview_sources(rows, max_characters=500)
    payload = json.dumps([evidence(s, i + 1) for i, s in enumerate(selected)], ensure_ascii=False)
    assert len(payload) <= 500 and selected and coverage["limited"]


def test_citations_reference_only_used_sources_and_remain_clickable():
    sources = [source(f"File {i}") for i in range(4)]
    answer, citations = cited_sources("The ending [4, 2]. The beginning [2]. Invalid [20].", sources)
    assert answer == "The ending [1][2]. The beginning [2]. Invalid ."
    assert citations == [sources[3], sources[1]]
    assert cited_sources("There is not enough evidence.", sources)[1] == []
