"""OpenAI function-tool definitions for the wardrobe agent."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "submit_ops",
            "description": (
                "Propose a list of wardrobe design changes. "
                "Each op in the list must be a valid typed op. "
                "The ops are dry-run validated before being sent to the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ops": {
                        "type": "array",
                        "description": "Ordered list of typed ops to apply to the design.",
                        "items": {"type": "object"},
                    },
                    "summary": {
                        "type": "string",
                        "description": "Short plain-language description of the proposed changes (shown to the user).",
                        "maxLength": 400,
                    },
                },
                "required": ["ops", "summary"],
                "additionalProperties": False,
            },
            "strict": False,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_clarification",
            "description": "Ask the user a clarifying question before proposing changes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The question or clarification request shown to the user.",
                        "maxLength": 600,
                    }
                },
                "required": ["message"],
                "additionalProperties": False,
            },
            "strict": False,
        },
    },
]
