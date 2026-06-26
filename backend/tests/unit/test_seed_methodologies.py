"""純結構驗證 seed_methodologies（不連線 Firestore）。"""

import re

import scripts.seed_methodologies as seed

STEPS = ["structure", "draft", "augment", "verify", "format"]

# 依任務表：doc id -> (categories, frontmatter source-type)
EXPECTED = {
    "youtube-deep-study": (["youtube"], "video"),
    "blog-deep-study": (["article"], "article"),
    "podcast-deep-study": (["article"], "podcast"),
    "coursera-deep-study": (["coursera"], "course"),
}

# 非法占位符：不是 session.state key，run 時會 KeyError。
ILLEGAL_PLACEHOLDERS = ["title", "url", "author"]


def _all_methodologies() -> dict[str, dict]:
    return seed.METHODOLOGIES


def _iter_instruction_strings(doc: dict):
    for step in STEPS:
        cfg = doc["steps"][step]
        instr = cfg["instruction"]
        yield instr["concise"]
        yield instr["detailed"]
        if "output_contract" in cfg:
            yield cfg["output_contract"]


def test_global_style_template_has_system():
    tmpl = seed.GLOBAL_STYLE_TEMPLATE
    sys_text = tmpl["system"]
    assert isinstance(sys_text, str) and sys_text.strip()
    assert "盤古之白" in sys_text or "全形" in sys_text
    assert "[!tip]" in sys_text


def test_four_methodologies_present():
    methodologies = _all_methodologies()
    assert set(methodologies.keys()) == set(EXPECTED.keys())


def test_methodology_structure():
    for mid, doc in _all_methodologies().items():
        assert doc.get("categories"), mid
        steps = doc["steps"]
        assert set(STEPS) <= set(steps.keys()), mid
        for step in STEPS:
            instr = steps[step]["instruction"]
            assert instr.get("concise"), f"{mid}/{step}/concise"
            assert instr.get("detailed"), f"{mid}/{step}/detailed"
        assert steps["format"].get("output_contract"), mid


def test_categories_and_source_type_mapping():
    for mid, (categories, source_type) in EXPECTED.items():
        doc = _all_methodologies()[mid]
        assert doc["categories"] == categories, mid
        contract = doc["steps"]["format"]["output_contract"]
        assert f"source-type: {source_type}" in contract, mid


def test_no_illegal_placeholders():
    # 掃描所有 instruction / output_contract，不得出現裸 {title}/{url}/{author}。
    for mid, doc in _all_methodologies().items():
        for text in _iter_instruction_strings(doc):
            for bad in ILLEGAL_PLACEHOLDERS:
                assert not re.search(r"\{" + bad + r"\??\}", text), \
                    f"{mid} contains illegal placeholder {{{bad}}}"


def test_format_uses_date_placeholder():
    for mid, doc in _all_methodologies().items():
        contract = doc["steps"]["format"]["output_contract"]
        assert "{date}" in contract, mid
