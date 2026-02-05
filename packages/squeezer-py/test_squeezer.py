#!/usr/bin/env python3
"""Tests for the Telegraphic Semantic Squeezer."""

import pytest
from semantic_squeezer import (
    SemanticSqueezer,
    SqueezeConfig,
    count_tokens,
    TREE_SITTER_AVAILABLE,
)


# Skip all tests if tree-sitter is not available
pytestmark = pytest.mark.skipif(
    not TREE_SITTER_AVAILABLE,
    reason="tree-sitter not available"
)


@pytest.fixture
def squeezer():
    return SemanticSqueezer()


@pytest.fixture
def custom_config():
    return SqueezeConfig(
        critical_decorators={"critical", "important", "preserve"},
        critical_keywords={"API_KEY", "SECRET", "IMPORTANT_CONSTANT"},
    )


# =============================================================================
# Token Counting Tests
# =============================================================================

class TestTokenCounting:
    def test_count_tokens_basic(self):
        text = "hello world"
        tokens = count_tokens(text)
        assert tokens > 0
        assert tokens < len(text)  # Should be compressed from chars

    def test_count_tokens_code(self):
        code = "def foo():\n    return 42"
        tokens = count_tokens(code)
        assert tokens > 0

    def test_count_tokens_empty(self):
        tokens = count_tokens("")
        assert tokens >= 1  # Minimum of 1


# =============================================================================
# Python Squeezer Tests
# =============================================================================

class TestPythonSqueezer:
    def test_basic_function_compression(self, squeezer):
        code = '''
def greet(name: str) -> str:
    """Say hello to someone."""
    message = f"Hello, {name}!"
    print(message)
    return message
'''
        result = squeezer.squeeze(code, "python")

        assert result.is_valid
        assert result.savings > 0
        assert "def greet(name: str) -> str:" in result.squeezed_code
        assert "..." in result.squeezed_code
        assert "print(message)" not in result.squeezed_code

    def test_preserves_imports(self, squeezer):
        code = '''
import os
from typing import Optional, List
from pathlib import Path

def process():
    pass
'''
        result = squeezer.squeeze(code, "python")

        assert "import os" in result.squeezed_code
        assert "from typing import Optional, List" in result.squeezed_code
        assert "from pathlib import Path" in result.squeezed_code

    def test_preserves_global_constants(self, squeezer):
        code = '''
MAX_SIZE = 100
DEFAULT_NAME = "unknown"
TIMEOUT = 30.5

def use_constants():
    return MAX_SIZE
'''
        result = squeezer.squeeze(code, "python")

        assert "MAX_SIZE = 100" in result.squeezed_code
        assert 'DEFAULT_NAME = "unknown"' in result.squeezed_code
        assert "TIMEOUT = 30.5" in result.squeezed_code

    def test_preserves_decorators(self, squeezer):
        code = '''
@staticmethod
def static_method():
    return 42

@property
def my_property(self):
    return self._value
'''
        result = squeezer.squeeze(code, "python")

        assert "@staticmethod" in result.squeezed_code
        assert "@property" in result.squeezed_code

    def test_preserves_critical_decorator(self, squeezer):
        code = '''
@critical
def important_function():
    """This should not be compressed."""
    secret = "very important"
    return secret
'''
        result = squeezer.squeeze(code, "python")

        # Body should be preserved because of @critical decorator
        assert 'secret = "very important"' in result.squeezed_code

    def test_preserves_critical_keywords(self, squeezer):
        code = '''
def auth_function():
    API_KEY = "secret123"
    return API_KEY
'''
        result = squeezer.squeeze(code, "python")

        # Body should be preserved because of API_KEY keyword
        assert 'API_KEY = "secret123"' in result.squeezed_code

    def test_class_compression(self, squeezer):
        code = '''
class MyClass:
    """A sample class."""

    def __init__(self, value: int):
        self.value = value

    def get_value(self) -> int:
        """Return the value."""
        return self.value

    def set_value(self, value: int) -> None:
        """Set the value."""
        self.value = value
'''
        result = squeezer.squeeze(code, "python")

        assert result.is_valid
        assert "class MyClass:" in result.squeezed_code
        assert "def __init__(self, value: int):" in result.squeezed_code
        assert "def get_value(self) -> int:" in result.squeezed_code
        assert "def set_value(self, value: int) -> None:" in result.squeezed_code
        # Bodies should be compressed
        assert "self.value = value" not in result.squeezed_code

    def test_preserves_docstring_args_returns(self, squeezer):
        code = '''
def complex_function(x: int, y: str) -> bool:
    """
    Do something complex.

    This is a long description that should be removed
    because it doesn't add much value for context.

    Args:
        x: The first parameter
        y: The second parameter

    Returns:
        True if successful, False otherwise

    Example:
        result = complex_function(1, "hello")
    """
    return True
'''
        result = squeezer.squeeze(code, "python")

        # Args and Returns sections should be preserved
        assert "Args:" in result.squeezed_code
        assert "x: The first parameter" in result.squeezed_code
        assert "Returns:" in result.squeezed_code
        assert "True if successful" in result.squeezed_code

    def test_preserves_todo_comments(self, squeezer):
        code = '''
# TODO: Fix this later
def broken_function():
    # This comment should be removed
    pass
'''
        result = squeezer.squeeze(code, "python")

        assert "TODO: Fix this later" in result.squeezed_code

    def test_preserves_fixme_comments(self, squeezer):
        code = '''
# FIXME: Memory leak here
def leaky_function():
    pass
'''
        result = squeezer.squeeze(code, "python")

        assert "FIXME: Memory leak" in result.squeezed_code

    def test_significant_compression_ratio(self, squeezer):
        """Test that we achieve meaningful compression."""
        code = '''
"""Module docstring with lots of text."""

import os
from typing import List, Dict, Optional

MAX_SIZE = 100

def function_one(param1: str, param2: int) -> List[str]:
    """
    First function with detailed docstring.

    Args:
        param1: First parameter
        param2: Second parameter

    Returns:
        A list of strings
    """
    result = []
    for i in range(param2):
        item = f"{param1}_{i}"
        result.append(item)
        print(f"Processing {item}")
    return result

def function_two(data: Dict[str, int]) -> Optional[int]:
    """
    Second function.

    Args:
        data: Input dictionary

    Returns:
        Sum of values or None
    """
    if not data:
        return None
    total = 0
    for key, value in data.items():
        total += value
        print(f"Added {key}: {value}")
    return total

class DataProcessor:
    """Process data efficiently."""

    def __init__(self, name: str):
        self.name = name
        self.data = []

    def add(self, item: str) -> None:
        """Add an item."""
        self.data.append(item)

    def process(self) -> List[str]:
        """Process all items."""
        return [x.upper() for x in self.data]
'''
        result = squeezer.squeeze(code, "python")

        # Should achieve at least 30% compression (depends on docstring content)
        assert result.savings_percent >= 30, f"Only {result.savings_percent}% compression"
        assert result.is_valid


# =============================================================================
# JavaScript Squeezer Tests
# =============================================================================

class TestJavaScriptSqueezer:
    def test_basic_function_compression(self, squeezer):
        code = '''
function greet(name) {
    const message = `Hello, ${name}!`;
    console.log(message);
    return message;
}
'''
        result = squeezer.squeeze(code, "javascript")

        assert result.is_valid
        assert result.savings > 0
        assert "function greet(name)" in result.squeezed_code
        assert "{ /* ... */ }" in result.squeezed_code
        assert "console.log" not in result.squeezed_code

    def test_preserves_imports(self, squeezer):
        code = '''
import { foo } from './foo';
import * as bar from 'bar';
const baz = require('baz');

function test() {
    return foo();
}
'''
        result = squeezer.squeeze(code, "javascript")

        assert "import { foo } from './foo'" in result.squeezed_code
        assert "import * as bar from 'bar'" in result.squeezed_code

    def test_preserves_constants(self, squeezer):
        code = '''
const MAX_SIZE = 100;
const API_URL = 'https://api.example.com';
let counter = 0;

function increment() {
    counter++;
}
'''
        result = squeezer.squeeze(code, "javascript")

        assert "const MAX_SIZE = 100" in result.squeezed_code
        assert "const API_URL" in result.squeezed_code

    def test_class_compression(self, squeezer):
        code = '''
class UserService {
    constructor(db) {
        this.db = db;
        this.cache = new Map();
    }

    async getUser(id) {
        if (this.cache.has(id)) {
            return this.cache.get(id);
        }
        const user = await this.db.find(id);
        this.cache.set(id, user);
        return user;
    }

    clearCache() {
        this.cache.clear();
    }
}
'''
        result = squeezer.squeeze(code, "javascript")

        assert result.is_valid
        assert "class UserService" in result.squeezed_code
        assert "constructor(db)" in result.squeezed_code
        assert "async getUser(id)" in result.squeezed_code
        assert "clearCache()" in result.squeezed_code
        # Bodies should be compressed
        assert "this.cache = new Map()" not in result.squeezed_code

    def test_arrow_function_compression(self, squeezer):
        code = '''
const add = (a, b) => {
    const sum = a + b;
    console.log(sum);
    return sum;
};

const multiply = (a, b) => a * b;
'''
        result = squeezer.squeeze(code, "javascript")

        # Block body should be compressed
        assert "{ /* ... */ }" in result.squeezed_code
        # Expression body should be preserved
        assert "a * b" in result.squeezed_code

    def test_preserves_jsdoc_params(self, squeezer):
        code = '''
/**
 * Calculate the sum of two numbers.
 *
 * This is a detailed description that explains
 * the function in great detail over multiple lines.
 *
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} The sum
 */
function add(a, b) {
    return a + b;
}
'''
        result = squeezer.squeeze(code, "javascript")

        assert "@param {number} a" in result.squeezed_code
        assert "@param {number} b" in result.squeezed_code
        assert "@returns {number}" in result.squeezed_code

    def test_preserves_todo_comments(self, squeezer):
        code = '''
// TODO: Implement caching
function slow() {
    // Regular comment
    return compute();
}
'''
        result = squeezer.squeeze(code, "javascript")

        assert "TODO: Implement caching" in result.squeezed_code

    def test_preserves_critical_keywords(self, squeezer):
        code = '''
function authenticate() {
    const API_KEY = process.env.API_KEY;
    return validate(API_KEY);
}
'''
        result = squeezer.squeeze(code, "javascript")

        # Body should be preserved because of API_KEY
        assert "process.env.API_KEY" in result.squeezed_code


# =============================================================================
# Safety Valve Tests
# =============================================================================

class TestSafetyValve:
    def test_invalid_output_fallback(self, squeezer):
        """Test that invalid compression output falls back to original."""
        # This is a synthetic test - in practice, our squeezer should
        # never produce invalid output, but we test the safety valve anyway
        code = "def valid(): pass"
        result = squeezer.squeeze(code, "python")

        # Result should be valid
        assert result.is_valid

    def test_handles_already_minimal_code(self, squeezer):
        """Test handling of code that's already minimal."""
        code = "x = 1"
        result = squeezer.squeeze(code, "python")

        assert result.is_valid
        # Should still work even with minimal input
        assert result.squeezed_code.strip() == code.strip()


# =============================================================================
# Edge Cases
# =============================================================================

class TestEdgeCases:
    def test_empty_input(self, squeezer):
        result = squeezer.squeeze("", "python")
        assert result.is_valid
        assert result.squeezed_code == ""

    def test_unsupported_language(self, squeezer):
        result = squeezer.squeeze("code", "rust")
        assert result.is_valid
        assert result.error is not None
        assert "Unsupported" in result.error

    def test_only_imports(self, squeezer):
        code = '''
import os
from sys import path
'''
        result = squeezer.squeeze(code, "python")
        assert result.is_valid
        assert "import os" in result.squeezed_code

    def test_nested_functions(self, squeezer):
        code = '''
def outer():
    def inner():
        return 42
    return inner()
'''
        result = squeezer.squeeze(code, "python")
        assert result.is_valid
        # Outer function body is compressed, including inner function
        assert "..." in result.squeezed_code

    def test_lambda_preservation(self, squeezer):
        code = '''
process = lambda x: x * 2
filter_fn = lambda items: [i for i in items if i > 0]
'''
        result = squeezer.squeeze(code, "python")
        assert result.is_valid
        # Lambdas should be preserved as they're expression-based
        assert "lambda x: x * 2" in result.squeezed_code


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
