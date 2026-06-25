"""種子方法論腳本。

寫入至少一份 `youtube` 適用的方法論文件到 Firestore `methodologies` collection，
讓 `/notes/stream` 在本地 / 部署環境有可用的 methodology 可跑通 happy path。

⚠️ **placeholder 警告**：本檔內 `instruction.concise` / `instruction.detailed`
是「可運作的通用佔位指令」，目的是讓 pipeline 跑得起來、產出格式正確的 Markdown；
**不是**使用者最終想要的精修方法論。等使用者提供真實的精修要求後，
應覆寫這些 instruction 字串（或在 Firestore console / 另一支腳本更新對應文件）。

用法（兩種皆可，於 `backend/` 目錄下執行）：
    uv run python scripts/seed_methodologies.py
    uv run python -m scripts.seed_methodologies

冪等：用固定文件 id（`youtube-deep-study`）`.set()`，重複執行只會覆寫同一份文件，
不會產生重複資料。
"""

import sys
from pathlib import Path

if __name__ == "__main__" and __package__ in (None, ""):
    # 直接以檔案路徑執行（非 `-m`）時，把 backend/ 根目錄加進 sys.path，
    # 讓 `from app.core.config import ...` 可解析。
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore

from app.core.config import get_settings

# ADK SequentialAgent 的 session state key 對應（見 app/agents/pipeline.py 的
# STEP_OUTPUT_KEY）：
#   structure -> state.outline
#   draft     -> state.draft
#   augment   -> state.augmented
#   verify    -> state.verified
#   format    -> state.final（最終 stream 輸出，不寫回 state 給後續步驟讀）
#
# 下方各步 instruction 用 ADK instruction 模板的 `{state_key}` 語法讀取前一步
# 的 session state；`{source}` 則是 collect 階段（程式前處理）寫入的
# state.source，所有步驟都可引用原文。

YOUTUBE_METHODOLOGY_ID = "youtube-deep-study"

YOUTUBE_METHODOLOGY: dict = {
    "name": "YouTube 深度學習筆記（佔位方法論）",
    "description": (
        "通用 YouTube 教學/演講 transcript 整理流程：先抓結構，"
        "再展開草稿、補充洞見、查證去幻覺，最後輸出繁體中文 Markdown。"
        "⚠️ 此為佔位方法論，真實精修要求待使用者提供後覆寫。"
    ),
    "categories": ["youtube"],
    "steps": {
        "structure": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "閱讀以下 YouTube 影片逐字稿，整理出精簡的大綱結構"
                    "（章節 / 重點條列，3-7 個一級項目即可）：\n\n{source}"
                ),
                "detailed": (
                    "閱讀以下 YouTube 影片逐字稿，整理出完整的大綱結構，"
                    "包含每個章節的子主題與時間軸線索（若逐字稿含時間標記）：\n\n{source}"
                ),
            },
        },
        "draft": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "依據下方大綱，將原始逐字稿展開成精簡的筆記草稿，"
                    "每個大綱項目用 1-3 句話說明重點即可：\n\n大綱：\n{outline}\n\n原文：\n{source}"
                ),
                "detailed": (
                    "依據下方大綱，將原始逐字稿展開成詳細的筆記草稿，"
                    "保留重要例子、數據與論證過程：\n\n大綱：\n{outline}\n\n原文：\n{source}"
                ),
            },
        },
        "augment": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "閱讀下方筆記草稿，補充 1-2 個簡短的延伸洞見或跨主題連結"
                    "（若無明顯可補充內容，保留原草稿即可）：\n\n{draft}"
                ),
                "detailed": (
                    "閱讀下方筆記草稿，補充延伸洞見、相關概念連結、可能的應用情境，"
                    "並標註哪些是你補充的內容（與原文區分）：\n\n{draft}"
                ),
            },
        },
        "verify": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "比對下方補充後的筆記與原始逐字稿，找出沒有依據、可能是幻覺的說法，"
                    "並標註或移除；若啟用網路查證工具，針對不確定的事實性陳述查證並附來源：\n\n"
                    "補充後筆記：\n{augmented}\n\n原文：\n{source}"
                ),
                "detailed": (
                    "逐項比對下方補充後的筆記與原始逐字稿，標出每個沒有原文依據的說法，"
                    "並說明理由；若啟用網路查證工具，對不確定的事實性陳述進行查證並附來源連結：\n\n"
                    "補充後筆記：\n{augmented}\n\n原文：\n{source}"
                ),
            },
        },
        "format": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "將下方已查證的筆記整理成最終的繁體中文 Markdown 筆記，"
                    "精簡扼要，符合輸出格式規範：\n\n{verified}"
                ),
                "detailed": (
                    "將下方已查證的筆記整理成最終的繁體中文 Markdown 筆記，"
                    "保留細節與例子，符合輸出格式規範：\n\n{verified}"
                ),
            },
            "output_contract": (
                "輸出純繁體中文 Markdown，結構為：\n"
                "# 標題\n\n## 大綱\n（條列式重點）\n\n## 詳細內容\n"
                "（依大綱展開的小節，使用 ## / ### 標題）\n\n"
                "## 延伸洞見\n（augment 步補充的內容，若有）\n\n"
                "## 參考來源\n（verify 步若有查證引用則列出連結，否則省略本節）\n\n"
                "不得包含與筆記整理無關的閒談或免責聲明。"
            ),
        },
    },
    "defaults": {"web_search": False},
    "version": 1,
}


def seed(client: firestore.Client | None = None) -> str:
    """寫入種子方法論文件，回傳寫入的文件 id。冪等：可重複執行。"""
    client = client or firestore.Client(project=get_settings().google_cloud_project)
    client.collection("methodologies").document(YOUTUBE_METHODOLOGY_ID).set(
        YOUTUBE_METHODOLOGY
    )
    return YOUTUBE_METHODOLOGY_ID


def main() -> None:
    doc_id = seed()
    print(f"已寫入方法論文件：methodologies/{doc_id}")


if __name__ == "__main__":
    main()
