from google.adk.agents import LlmAgent, SequentialAgent

from app.agents.models import build_model
from app.agents.tools import web_search_tools
from app.schemas.requests import Provider

STEP_ORDER = ["structure", "draft", "augment", "verify", "format"]
STEP_OUTPUT_KEY = {
    "structure": "outline", "draft": "draft", "augment": "augmented",
    "verify": "verified", "format": "final",
}


def _instruction(step_cfg: dict, mode: str) -> str:
    instr = step_cfg.get("instruction")
    if isinstance(instr, dict):
        return instr.get(mode) or instr.get("detailed") or ""
    return instr or ""


def build_pipeline(methodology, mode, provider: Provider, model_id, web_search, system):
    model = build_model(provider, model_id)
    steps = methodology.get("steps", {})
    sub_agents = []
    for name in STEP_ORDER:
        cfg = steps.get(name, {})
        if not cfg.get("enabled", True):
            continue
        tools = web_search_tools(provider, web_search) if name == "verify" else []
        sub_agents.append(LlmAgent(
            name=f"step_{name}",
            model=model,
            instruction=f"{system}\n\n{_instruction(cfg, mode)}",
            output_key=STEP_OUTPUT_KEY[name],
            tools=tools,
        ))
    return SequentialAgent(name="note_pipeline", sub_agents=sub_agents)
