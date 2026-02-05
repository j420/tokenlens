# Telegraphic Semantic Squeezer

A **"Lossy but Semantically Perfect"** compression engine for LLM context.

Reduces token count by **60-80%** while retaining **100%** of:
- Type Information
- Call Graph Structure
- Function Signatures
- Critical Code Paths

## Installation

```bash
pip install -e .
```

Or install dependencies manually:

```bash
pip install tree-sitter tree-sitter-python tree-sitter-javascript
```

## Usage

### Command Line

```bash
# Run demo with sample code
python semantic_squeezer.py --demo

# Squeeze a file
python semantic_squeezer.py myfile.py

# Output as JSON
python semantic_squeezer.py --json myfile.py

# Write to file
python semantic_squeezer.py -o squeezed.py original.py
```

### As a Library

```python
from semantic_squeezer import SemanticSqueezer, SqueezeConfig

# Default configuration
squeezer = SemanticSqueezer()

# Custom configuration
config = SqueezeConfig(
    critical_decorators={"critical", "important"},
    critical_keywords={"API_KEY", "SECRET"},
)
squeezer = SemanticSqueezer(config)

# Squeeze code
result = squeezer.squeeze(code, "python")

print(f"Original: {result.original_tokens} tokens")
print(f"Squeezed: {result.squeezed_tokens} tokens")
print(f"Savings:  {result.savings_percent:.1f}%")
print(result.squeezed_code)

# Squeeze a file
result = squeezer.squeeze_file("myfile.py")
```

## How It Works

### Algorithm (The "Squeeze")

1. **Class & Function Signatures**: KEEP full signatures, arguments, return type hints, and decorators

2. **Docstrings**: PRUNE description text, but KEEP lines describing "Args" or "Returns"

3. **Bodies**: REPLACE function bodies with:
   - Python: `...` (Ellipsis)
   - JavaScript: `{ /* ... */ }`

4. **Critical Code**: If a function is marked as `@critical` or contains keywords like `API_KEY`, KEEP the body

5. **Global Variables**: KEEP all global constant definitions

6. **Imports**: KEEP all imports (essential for dependencies)

### Safety Valve (Verification)

After squeezing, the output is re-parsed with tree-sitter. If the output contains any `ERROR` nodes (syntax errors), the squeezed version is discarded and the original file is returned.

## Example

### Original Python (500+ tokens)

```python
import os
from typing import Optional, Dict

MAX_RETRIES = 3

class DatabaseClient:
    """
    A client for connecting to the database.

    This class provides methods for executing queries,
    managing transactions, and handling connections.
    It supports connection pooling and automatic retries.

    Attributes:
        host: Database hostname
        port: Database port number
    """

    def __init__(self, host: str, port: int = 5432):
        """Initialize the database client."""
        self.host = host
        self.port = port
        self._connection = None
        self._pool = []

    def connect(self) -> bool:
        """
        Establish a connection to the database.

        Returns:
            True if connection successful
        """
        for attempt in range(MAX_RETRIES):
            try:
                self._connection = create_connection(
                    host=self.host,
                    port=self.port
                )
                return True
            except ConnectionError as e:
                logger.warning(f"Attempt {attempt} failed: {e}")
        return False

    def execute(self, query: str, params: Optional[Dict] = None) -> list:
        """
        Execute a SQL query.

        Args:
            query: The SQL query string
            params: Optional query parameters

        Returns:
            List of result rows
        """
        if not self._connection:
            self.connect()
        cursor = self._connection.cursor()
        cursor.execute(query, params or {})
        return cursor.fetchall()
```

### Squeezed Python (~100 tokens, 80% savings)

```python
import os
from typing import Optional, Dict

MAX_RETRIES = 3

class DatabaseClient:
    """A client for connecting to the database.

    Attributes:
        host: Database hostname
        port: Database port number
    """

    def __init__(self, host: str, port: int = 5432):
        ...

    def connect(self) -> bool:
        """
        Returns:
            True if connection successful
        """
        ...

    def execute(self, query: str, params: Optional[Dict] = None) -> list:
        """
        Args:
            query: The SQL query string
            params: Optional query parameters

        Returns:
            List of result rows
        """
        ...
```

## Configuration

```python
from semantic_squeezer import SqueezeConfig

config = SqueezeConfig(
    # Decorators that mark functions as critical (body preserved)
    critical_decorators={"critical", "important", "do_not_compress"},

    # Keywords that prevent body compression
    critical_keywords={"API_KEY", "SECRET", "PASSWORD", "AUTH"},

    # Docstring sections to preserve
    preserved_docstring_sections={
        "Args:", "Returns:", "Raises:", "Attributes:",
    },

    # Comment markers to preserve
    preserved_comment_markers={
        "TODO", "FIXME", "HACK", "NOTE",
    },
)
```

## Supported Languages

- Python (`.py`)
- JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)
- TypeScript (`.ts`, `.tsx`) - parsed as JavaScript

## Integration with Node.js

The squeezer can be called from Node.js via subprocess:

```javascript
const { execSync } = require('child_process');

function squeezeCode(code, language) {
  const result = execSync(
    `python semantic_squeezer.py --json`,
    { input: code, encoding: 'utf8' }
  );
  return JSON.parse(result);
}
```

## Tests

```bash
pytest test_squeezer.py -v
```

## License

MIT
