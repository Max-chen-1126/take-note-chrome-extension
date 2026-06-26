"""種子方法論 + 全域風格腳本。

寫入 **1 份 global-style prompt template + 4 份 methodology** 到 Firestore，
讓 `/notes/stream` 能套用使用者真正的筆記系統規格。

doc 對映：
    prompt_templates/global-style   全域繁中風格規則（system 提示）
    methodologies/youtube-deep-study   YouTube 影片（source-type: video）
    methodologies/blog-deep-study      技術部落格文章（source-type: article）
    methodologies/podcast-deep-study   Podcast（source-type: podcast）
    methodologies/coursera-deep-study  Coursera 課程影片（source-type: course）

用法（兩種皆可，於 `backend/` 目錄下執行）：
    uv run python scripts/seed_methodologies.py
    uv run python -m scripts.seed_methodologies

冪等：用固定文件 id `.set()`，重複執行只覆寫同一份文件。結尾並刪除舊的
placeholder `methodologies/article-deep-study`（若存在），避免下拉選單留孤兒。

⚠️ ADK `{key}` 硬限制：LlmAgent.instruction 的 `{key}` 在 run 時從 session.state
取代，缺 key 會 KeyError。只用永遠存在的 state key：
    {source} {outline} {draft} {augmented} {verified} {date} {direction} {extra}
**絕對不要**用 {title}/{url}/{author}——它們不是 state key。frontmatter 的
title/url/author 改為**指示模型從 {source} 文字中擷取**（{source} 內含
`# 標題` 與 `來源: <url>` 兩行，由 collect 階段 build_source 寫入）。

⚠️ ADK SequentialAgent 的 session state key 對映（見 app/agents/pipeline.py 的
STEP_OUTPUT_KEY）：
    structure -> state.outline
    draft     -> state.draft
    augment   -> state.augmented
    verify    -> state.verified
    format    -> state.final（最終 stream 輸出，不寫回 state）
"""

import sys
from pathlib import Path

if __name__ == "__main__" and __package__ in (None, ""):
    # 直接以檔案路徑執行（非 `-m`）時，把 backend/ 根目錄加進 sys.path，
    # 讓 `from app.core.config import ...` 可解析。
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore

from app.core.config import get_settings

# ---------------------------------------------------------------------------
# 全域風格 template（所有方法論共用，注入為 LlmAgent 的 system 前綴）
# ---------------------------------------------------------------------------

GLOBAL_STYLE_TEMPLATE_ID = "global-style"

_GLOBAL_STYLE_SYSTEM = (
    "你是使用者的個人知識管理助手，依下列「全域筆記風格規則」整理筆記。"
    "輸出貼進 Obsidian 即可用的繁體中文 Markdown。\n\n"
    "# 語言與排版\n"
    "- 一律使用繁體中文；中文標點一律用全形（。，、；：？！「」）。\n"
    "- 盤古之白：中文與英文 / 數字之間加一個半形空格。"
    "例如「使用 BGP 交換路由」「約 75% 的流量」。\n"
    "- 專有名詞保留英文原文；縮寫首次出現時補全稱，"
    "例如「BGP（Border Gateway Protocol）」。\n\n"
    "# 內容取捨\n"
    "- 不要把來源全文貼進筆記；整理成可複習、可萃取的內容。\n"
    "- 少用 `---` 分隔線、少用 emoji。\n\n"
    "# 標記語法（Obsidian / HTML mark）\n"
    "- 關鍵主張：`<mark style=\"background: #FFB86CA6;\">…</mark>`。\n"
    "- 定義 / 術語：`<mark class=\"hltr-green\">…</mark>`。\n"
    "- 風險 / 注意：`> [!warning]` callout。\n"
    "- 引文：`> [!quote]` callout。\n"
    "- 待提煉：`> [!tip]` callout。\n\n"
    "# 三積木法\n"
    "- 先產出 Source Note 初版，不要急著拆很多 Concept。\n"
    "- 最後只列「待提煉的原子概念」，每條寫成**完整句子**（不是名詞片語），"
    "且**不要放空的 `[[連結]]`**。\n\n"
    "# 品質自查（輸出前確認）\n"
    "- 有一句話 summary 能不讀全文就懂核心價值？\n"
    "- 保留上下文但非全文剪藏？\n"
    "- 重點整理成問題 / 流程 / 框架 / 判斷的形式？\n"
    "- 列出可提煉的原子概念（完整句、無空連結）？\n"
    "- 繁中 + 全形標點 + 盤古之白 + 英文專有名詞保留？\n"
)

GLOBAL_STYLE_TEMPLATE: dict = {
    "system": _GLOBAL_STYLE_SYSTEM,
    "version": 1,
}

# ---------------------------------------------------------------------------
# 共用 frontmatter 片段（每份 format output_contract 都要求輸出在最前面）。
# title/url/author 指示模型從 {source} 擷取；created/updated 用 {date}。
# ---------------------------------------------------------------------------

def _frontmatter(source_type: str) -> str:
    return (
        "最前面必須輸出 YAML frontmatter，欄位如下（title / author / url 從 "
        "{source} 文字擷取，{source} 內含 `# 標題` 與 `來源: <url>` 兩行；"
        "找不到作者則留空）：\n"
        "```\n"
        "---\n"
        "title: <從 source 擷取的標題>\n"
        "type: source\n"
        f"source-type: {source_type}\n"
        "author: <從 source 擷取的作者 / 頻道，無則留空>\n"
        "url: <從 source 擷取的網址>\n"
        "status: done\n"
        "tags: []\n"
        "summary: <一句話，能不讀全文就懂核心價值>\n"
        "created: {date}\n"
        "updated: {date}\n"
        "---\n"
        "```\n"
    )


# 共用各步驟（structure/draft/augment/verify）指令；format 各方法論不同。
def _shared_steps(kind: str) -> dict:
    """kind 用於 structure/draft 的「來源類型」措辭，例如「YouTube 影片逐字稿」。"""
    return {
        "structure": {
            "enabled": True,
            "instruction": {
                "concise": (
                    f"閱讀以下{kind}，依其內容抓出精簡的大綱骨架"
                    "（章節 / 主題條列，3-7 個一級項目即可）：\n\n{source}"
                ),
                "detailed": (
                    f"閱讀以下{kind}，整理出完整的大綱骨架，"
                    "包含各章節的子主題與關鍵線索：\n\n{source}"
                ),
            },
        },
        "draft": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "依據下方大綱與原文，展開成精簡的筆記草稿，"
                    "每個大綱項目用 1-3 句話說明重點即可：\n\n"
                    "大綱：\n{outline}\n\n原文：\n{source}"
                ),
                "detailed": (
                    "依據下方大綱與原文，展開成詳細的筆記草稿，"
                    "保留重要例子、數據與論證過程：\n\n"
                    "大綱：\n{outline}\n\n原文：\n{source}"
                ),
            },
        },
        "augment": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "閱讀下方筆記草稿，補充「框架與模型」與少量延伸連結，"
                    "並在結尾整理「待提煉的原子概念」（每條完整句、不要空 `[[連結]]`）："
                    "\n\n{draft}"
                ),
                "detailed": (
                    "閱讀下方筆記草稿，補充「框架與模型」（分類 / 流程 / 比較）、"
                    "延伸概念與應用情境，並在結尾整理「待提煉的原子概念」"
                    "（每條完整句、不要空 `[[連結]]`，可加 `> [!tip]`）：\n\n{draft}"
                ),
            },
        },
        "verify": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "比對下方補充後的筆記與原文，找出沒有依據、可能是幻覺的說法並標註或移除；"
                    "若啟用網路查證工具，針對不確定的事實性陳述查證並附來源：\n\n"
                    "補充後筆記：\n{augmented}\n\n原文：\n{source}"
                ),
                "detailed": (
                    "逐項比對下方補充後的筆記與原文，標出每個沒有原文依據的說法並說明理由；"
                    "若啟用網路查證工具，對不確定的事實性陳述逐一查證並附來源連結：\n\n"
                    "補充後筆記：\n{augmented}\n\n原文：\n{source}"
                ),
            },
        },
    }


# ---------------------------------------------------------------------------
# 1) youtube-deep-study（source-type: video）
# ---------------------------------------------------------------------------

_YOUTUBE_FORMAT_SECTIONS = (
    "章節骨架（detailed 用完整骨架；concise 省略細節展開，只留總結 + 精簡重點 + "
    "核心結論 + 待提煉）：\n"
    "- `# 標題`\n"
    "- `## 總結`：1-2 段核心論點。\n"
    "- `## Note`：用**問題式 `###` 小標**組織，整理該問題的回答與推論。\n"
    "- `## 框架與模型`：影片若提出分類 / 流程 / 架構 / 比較才寫，可用表格。\n"
    "- `## 待提煉的原子概念`：`> [!tip]` callout + 完整句 checklist，無空連結。\n"
    "- `## 延伸參考`：相關資源 / 後續可深入的主題。\n"
)

YOUTUBE_METHODOLOGY: dict = {
    "name": "YouTube 深度學習筆記",
    "description": (
        "YouTube 教學 / 演講影片逐字稿深度整理：抓結構、展開、補框架與原子概念、"
        "查證去幻覺，輸出含 frontmatter 的 Obsidian 筆記。"
    ),
    "categories": ["youtube"],
    "steps": {
        **_shared_steps("YouTube 影片逐字稿"),
        "format": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，精簡扼要，"
                    "嚴格遵守 output_contract 的 frontmatter 與章節結構：\n\n{verified}"
                ),
                "detailed": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，保留例子、數據與論證，"
                    "嚴格遵守 output_contract 的 frontmatter 與完整章節結構：\n\n{verified}"
                ),
            },
            "output_contract": (
                _frontmatter("video") + "\n" + _YOUTUBE_FORMAT_SECTIONS +
                "\n遵守全域風格規則；不要貼逐字稿原文，不要無關閒談。"
            ),
        },
    },
    "defaults": {"web_search": False},
    "version": 1,
}

# ---------------------------------------------------------------------------
# 2) blog-deep-study（source-type: article）
# ---------------------------------------------------------------------------

_BLOG_FORMAT_SECTIONS = (
    "章節骨架（detailed 用完整骨架；concise 只留一句話總結 + 精簡重點摘錄 + "
    "核心結論 + 待提煉）：\n"
    "- `# 標題`\n"
    "- `## 一句話總結`\n"
    "- `## 重點摘錄`：detailed 用 `### 1.背景 / 問題緣由`、`### 2.初步觀察`、"
    "`### 3.深入原因`、`### 4.解法 / 核心主張`、`### 5.結果`、"
    "`### 6.使用時的注意事項`；若文章是 debugging / incident 類，改用"
    "「事件緣由 → 觀察 → 根因 → 解法 → 結果 → 注意事項」。\n"
    "- `## Takeaway`：`### 技術面`、`### 方法論面`、`### 核心結論`。\n"
    "- `## 待提煉的原子概念`：`> [!tip]` + 完整句 checklist，無空連結。\n"
    "- `## 相關與延伸閱讀`。\n"
)

BLOG_METHODOLOGY: dict = {
    "name": "技術部落格深度筆記",
    "description": (
        "技術部落格文章深度整理：抓結構、依背景 / 觀察 / 根因 / 解法展開、"
        "提煉 Takeaway 與原子概念、查證去幻覺，輸出含 frontmatter 的 Obsidian 筆記。"
    ),
    "categories": ["article"],
    "steps": {
        **_shared_steps("技術部落格文章"),
        "format": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，精簡扼要，"
                    "嚴格遵守 output_contract 的 frontmatter 與章節結構：\n\n{verified}"
                ),
                "detailed": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，保留例子、數據與論證，"
                    "嚴格遵守 output_contract 的 frontmatter 與完整章節結構：\n\n{verified}"
                ),
            },
            "output_contract": (
                _frontmatter("article") + "\n" + _BLOG_FORMAT_SECTIONS +
                "\n遵守全域風格規則；不要全文剪藏，不要無關閒談。"
            ),
        },
    },
    "defaults": {"web_search": False},
    "version": 1,
}

# ---------------------------------------------------------------------------
# 3) podcast-deep-study（source-type: podcast；categories 仍為 article）
# ---------------------------------------------------------------------------

_PODCAST_FORMAT_SECTIONS = (
    "章節骨架（detailed 用完整骨架；concise 只留總結 + 精簡重點 + 核心結論 + 待提煉）：\n"
    "- `# 標題`\n"
    "- `## 總結`：1-2 段核心論點。\n"
    "- `## Note`：依**主題群、問題式 `###` 標題**組織；保留核心主張、"
    "有判斷力的觀點與框架，去除閒聊與重複。\n"
    "- `## 框架與模型`：可用表格 / 分類 / 三要素 / 流程呈現。\n"
    "- `## 待提煉的原子概念`：`> [!tip]` + 完整句 checklist，無空連結。\n"
    "- `## 延伸參考`。\n"
)

PODCAST_METHODOLOGY: dict = {
    "name": "Podcast 深度筆記",
    "description": (
        "Podcast 逐字稿深度整理：抓主題群、依問題式標題展開、保留有判斷力的觀點、"
        "提煉框架與原子概念、查證去幻覺，輸出含 frontmatter 的 Obsidian 筆記。"
    ),
    "categories": ["article"],
    "steps": {
        **_shared_steps("Podcast 逐字稿"),
        "format": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，精簡扼要，"
                    "嚴格遵守 output_contract 的 frontmatter 與章節結構：\n\n{verified}"
                ),
                "detailed": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，保留有判斷力的觀點與框架，"
                    "嚴格遵守 output_contract 的 frontmatter 與完整章節結構：\n\n{verified}"
                ),
            },
            "output_contract": (
                _frontmatter("podcast") + "\n" + _PODCAST_FORMAT_SECTIONS +
                "\n遵守全域風格規則；去除閒聊與重複，不要無關內容。"
            ),
        },
    },
    "defaults": {"web_search": False},
    "version": 1,
}

# ---------------------------------------------------------------------------
# 4) coursera-deep-study（source-type: course，單支課程影片）
# ---------------------------------------------------------------------------

_COURSERA_FORMAT_SECTIONS = (
    "章節骨架（單支課程影片；detailed 用完整骨架，concise 省略細節展開）：\n"
    "- `# 影片標題`\n"
    "- `#### 1. Overview`：1 段說明這支影片在講什麼。\n"
    "- `#### 2. 重點與對應學習目標`：用「**學習目標 X：標題**」+ 重點條列組織；"
    "技術流程用 ```text 區塊畫 tree。\n"
    "- `#### 3. 額外參考`。\n"
    "**不要貼 transcript 原文。**\n"
)

COURSERA_METHODOLOGY: dict = {
    "name": "Coursera 課程筆記",
    "description": (
        "Coursera 單支課程影片整理：抓 Overview、對應學習目標展開重點、"
        "技術流程用 tree 呈現，輸出含 frontmatter 的 Obsidian 筆記，不貼 transcript 原文。"
    ),
    "categories": ["coursera"],
    "steps": {
        **_shared_steps("Coursera 課程影片逐字稿"),
        "format": {
            "enabled": True,
            "instruction": {
                "concise": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，精簡扼要，"
                    "嚴格遵守 output_contract 的 frontmatter 與章節結構：\n\n{verified}"
                ),
                "detailed": (
                    "將下方已查證的筆記組裝成最終 Obsidian 筆記，保留學習目標的重點細節，"
                    "嚴格遵守 output_contract 的 frontmatter 與完整章節結構：\n\n{verified}"
                ),
            },
            "output_contract": (
                _frontmatter("course") + "\n" + _COURSERA_FORMAT_SECTIONS +
                "\n遵守全域風格規則；不要貼 transcript 原文，不要無關閒談。"
            ),
        },
    },
    "defaults": {"web_search": False},
    "version": 1,
}

# ---------------------------------------------------------------------------
# 註冊表
# ---------------------------------------------------------------------------

METHODOLOGIES: dict[str, dict] = {
    "youtube-deep-study": YOUTUBE_METHODOLOGY,
    "blog-deep-study": BLOG_METHODOLOGY,
    "podcast-deep-study": PODCAST_METHODOLOGY,
    "coursera-deep-study": COURSERA_METHODOLOGY,
}

# 舊 placeholder：被 blog / podcast 取代，seed 結尾刪除避免下拉選單留孤兒。
_OBSOLETE_METHODOLOGY_IDS = ["article-deep-study"]


def seed(client: firestore.Client | None = None) -> list[str]:
    """寫入 global-style + 4 份方法論，回傳寫入的 doc 路徑清單。冪等：可重複執行。"""
    client = client or firestore.Client(project=get_settings().google_cloud_project)
    written: list[str] = []

    client.collection("prompt_templates").document(GLOBAL_STYLE_TEMPLATE_ID).set(
        GLOBAL_STYLE_TEMPLATE
    )
    written.append(f"prompt_templates/{GLOBAL_STYLE_TEMPLATE_ID}")

    for mid, doc in METHODOLOGIES.items():
        client.collection("methodologies").document(mid).set(doc)
        written.append(f"methodologies/{mid}")

    # 清理舊 placeholder（不存在 delete 也安全）。
    for obsolete in _OBSOLETE_METHODOLOGY_IDS:
        client.collection("methodologies").document(obsolete).delete()

    return written


def main() -> None:
    written = seed()
    print("已寫入：")
    for path in written:
        print(f"  {path}")
    print(f"已刪除舊 placeholder：{_OBSOLETE_METHODOLOGY_IDS}")


if __name__ == "__main__":
    main()
