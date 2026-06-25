from app.agents.pipeline import build_pipeline, STEP_ORDER
from app.schemas.requests import Provider


def _methodology(disabled=()):
    steps = {}
    for s in STEP_ORDER:
        steps[s] = {
            "enabled": s not in disabled,
            "instruction": {"concise": f"{s}-c", "detailed": f"{s}-d"},
        }
    return {"name": "M", "categories": ["youtube"], "steps": steps}


def test_builds_all_steps_concise():
    agent = build_pipeline(_methodology(), "concise", Provider.gemini, None, False, "SYS")
    assert [a.name for a in agent.sub_agents] == [f"step_{s}" for s in STEP_ORDER]
    assert "structure-c" in agent.sub_agents[0].instruction


def test_skips_disabled_step():
    agent = build_pipeline(_methodology(disabled=("augment",)), "detailed",
                           Provider.gemini, None, False, "SYS")
    names = [a.name for a in agent.sub_agents]
    assert "step_augment" not in names
    assert "augment-d" not in "".join(a.instruction for a in agent.sub_agents)
