# ChatBotAssistant

ChatBotAssistant is an AI-powered server for local code and document search, error diagnostics, root cause analysis, and automated troubleshooting workflows. 
It supports Java, C, DOCX, PDF, and can be integrated with Claude or other LLMs for advanced suggestions and code/document analysis.

## Features

- **Code & Document Search:** Find relevant code (Java, C) and documentation (DOCX, PDF) in your local directory.
- **Error Log Analysis:** Parse logs, detect stack traces, and extract error messages.
- **Root Cause Analysis:** LLM-powered root cause explanations for issues found in your code and logs.
- **Automated Fix Suggestions:** Actionable tips and code snippets to resolve issues.
- **Interactive Walkthroughs:** Step-by-step diagnostic workflows powered by the LLM.
- **Code Review / Linting:** LLM-based static analysis for style, security, and best practices.
- **Dependency & Environment Checks:** Analyze configuration and dependency files for problems.
- **Knowledge Base Search:** LLM-powered search for relevant documentation and Stack Overflow links.
- **Visualization:** Generate call graphs and dependency diagrams using LLMs.
- **Personalization & Translation:** Adapt responses to user level and translate to multiple languages.

## API Endpoints

- `POST /search` — Search code and docs for a query.
- `POST /analyze-log` — Analyze an error log with optional code/doc context.
- `POST /scan-pitfalls` — Proactively scan codebase for risky patterns.
- `POST /lint` — LLM-powered code review.
- `POST /deps` — Dependency/environment analysis.
- `POST /kb` — Search knowledge base.
- `POST /workflow` — Get troubleshooting workflow.
- `POST /chat/next` — Next best step in troubleshooting.
- `POST /visualize` — Generate call graph visualization.
- `POST /translate` — Translate responses.

## Usage

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set your Claude API key (or compatible LLM) in the environment:

   ```bash
   export CLAUDE_API_KEY=your-key-here
   ```

3. Start the ChatbotAssistant server:

   ```bash
   npm start
   ```

4. Make API calls as documented above.

## License

MIT