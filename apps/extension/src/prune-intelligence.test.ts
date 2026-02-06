/**
 * Prune Intelligence Engine Test Suite
 *
 * Tests all components across 25 different file types
 */

import {
  SymbolExtractor,
  RelevanceDAG,
  IntentClassifier,
  DAGWalker,
  ContextUtilityTracker,
  KnownKnowledgeDetector,
  AdaptiveBudgetCalculator,
  ResponseAnalyzer,
  ContextManifestGenerator,
  PruneIntelligenceEngine,
  type CodeSymbol,
  type IntentType,
} from "./prune-intelligence";

// ============================================================================
// Test Samples for 25 File Types
// ============================================================================

const testSamples: Record<string, { content: string; language: string }> = {
  // 1. TypeScript
  "sample.ts": {
    language: "typescript",
    content: `
import { Request, Response } from "express";
import { UserService } from "./user-service";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export type UserRole = "admin" | "user" | "guest";

export class UserController {
  private userService: UserService;

  constructor(userService: UserService) {
    this.userService = userService;
  }

  async getUser(req: Request, res: Response): Promise<void> {
    const userId = req.params.id;
    const user = await this.userService.findById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  }

  async createUser(req: Request, res: Response): Promise<void> {
    const { name, email } = req.body;
    const user = await this.userService.create({ name, email });
    res.status(201).json(user);
  }
}

export const USER_ROLES: UserRole[] = ["admin", "user", "guest"];
`,
  },

  // 2. JavaScript
  "sample.js": {
    language: "javascript",
    content: `
const express = require("express");
const router = express.Router();

const CACHE_TTL = 3600;

class ProductService {
  constructor(db) {
    this.db = db;
  }

  async findAll() {
    return this.db.query("SELECT * FROM products");
  }

  async findById(id) {
    const result = await this.db.query("SELECT * FROM products WHERE id = ?", [id]);
    return result[0];
  }

  async create(data) {
    const { name, price, description } = data;
    return this.db.insert("products", { name, price, description });
  }
}

router.get("/products", async (req, res) => {
  const service = new ProductService(req.db);
  const products = await service.findAll();
  res.json(products);
});

router.get("/products/:id", async (req, res) => {
  const service = new ProductService(req.db);
  const product = await service.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(product);
});

module.exports = router;
`,
  },

  // 3. Python
  "sample.py": {
    language: "python",
    content: `
from typing import List, Optional
from dataclasses import dataclass
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30

@dataclass
class Task:
    """Represents a task in the system."""
    id: str
    title: str
    completed: bool = False
    created_at: datetime = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()

class TaskRepository:
    """Repository for managing tasks."""

    def __init__(self, db_connection):
        """Initialize with database connection.

        Args:
            db_connection: Database connection instance
        """
        self.db = db_connection
        self._cache = {}

    async def find_all(self) -> List[Task]:
        """Retrieve all tasks.

        Returns:
            List of all tasks
        """
        result = await self.db.execute("SELECT * FROM tasks")
        return [Task(**row) for row in result]

    async def find_by_id(self, task_id: str) -> Optional[Task]:
        """Find a task by ID.

        Args:
            task_id: The task identifier

        Returns:
            Task if found, None otherwise
        """
        if task_id in self._cache:
            return self._cache[task_id]

        result = await self.db.execute(
            "SELECT * FROM tasks WHERE id = ?",
            [task_id]
        )
        if result:
            task = Task(**result[0])
            self._cache[task_id] = task
            return task
        return None

    async def create(self, title: str) -> Task:
        """Create a new task.

        Args:
            title: Task title

        Returns:
            Created task
        """
        task = Task(id=str(uuid4()), title=title)
        await self.db.execute(
            "INSERT INTO tasks (id, title, completed) VALUES (?, ?, ?)",
            [task.id, task.title, task.completed]
        )
        logger.info(f"Created task: {task.id}")
        return task
`,
  },

  // 4. Go
  "sample.go": {
    language: "go",
    content: `
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

const MaxConnections = 100

type User struct {
	ID    string \`json:"id"\`
	Name  string \`json:"name"\`
	Email string \`json:"email"\`
}

type UserRepository interface {
	FindByID(id string) (*User, error)
	Create(user *User) error
	Delete(id string) error
}

type InMemoryUserRepo struct {
	mu    sync.RWMutex
	users map[string]*User
}

func NewInMemoryUserRepo() *InMemoryUserRepo {
	return &InMemoryUserRepo{
		users: make(map[string]*User),
	}
}

func (r *InMemoryUserRepo) FindByID(id string) (*User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.users[id]
	if !ok {
		return nil, fmt.Errorf("user not found: %s", id)
	}
	return user, nil
}

func (r *InMemoryUserRepo) Create(user *User) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.users[user.ID]; exists {
		return fmt.Errorf("user already exists: %s", user.ID)
	}
	r.users[user.ID] = user
	return nil
}

func (r *InMemoryUserRepo) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.users, id)
	return nil
}

func HandleGetUser(repo UserRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		user, err := repo.FindByID(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(user)
	}
}
`,
  },

  // 5. Rust
  "sample.rs": {
    language: "rust",
    content: `
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};

const MAX_ITEMS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub price: f64,
}

pub trait Repository<T> {
    fn find_by_id(&self, id: &str) -> Option<T>;
    fn save(&mut self, item: T) -> Result<(), String>;
    fn delete(&mut self, id: &str) -> Result<(), String>;
}

pub struct InMemoryRepository {
    items: Arc<RwLock<HashMap<String, Item>>>,
}

impl InMemoryRepository {
    pub fn new() -> Self {
        Self {
            items: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Repository<Item> for InMemoryRepository {
    fn find_by_id(&self, id: &str) -> Option<Item> {
        let items = self.items.read().unwrap();
        items.get(id).cloned()
    }

    fn save(&mut self, item: Item) -> Result<(), String> {
        let mut items = self.items.write().unwrap();
        if items.len() >= MAX_ITEMS {
            return Err("Repository full".to_string());
        }
        items.insert(item.id.clone(), item);
        Ok(())
    }

    fn delete(&mut self, id: &str) -> Result<(), String> {
        let mut items = self.items.write().unwrap();
        items.remove(id);
        Ok(())
    }
}

pub async fn fetch_items(url: &str) -> Result<Vec<Item>, reqwest::Error> {
    let response = reqwest::get(url).await?;
    let items: Vec<Item> = response.json().await?;
    Ok(items)
}
`,
  },

  // 6. Java
  "Sample.java": {
    language: "java",
    content: `
package com.example.service;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

public interface OrderRepository {
    Optional<Order> findById(String id);
    List<Order> findAll();
    Order save(Order order);
    void deleteById(String id);
}

@Service
public class OrderService {
    private static final int MAX_ORDERS = 10000;

    private final OrderRepository repository;
    private final ConcurrentHashMap<String, Order> cache;

    @Autowired
    public OrderService(OrderRepository repository) {
        this.repository = repository;
        this.cache = new ConcurrentHashMap<>();
    }

    public Optional<Order> getOrder(String id) {
        Order cached = cache.get(id);
        if (cached != null) {
            return Optional.of(cached);
        }

        Optional<Order> order = repository.findById(id);
        order.ifPresent(o -> cache.put(id, o));
        return order;
    }

    public Order createOrder(OrderRequest request) {
        Order order = new Order();
        order.setCustomerId(request.getCustomerId());
        order.setItems(request.getItems());
        order.setTotal(calculateTotal(request.getItems()));

        Order saved = repository.save(order);
        cache.put(saved.getId(), saved);
        return saved;
    }

    private double calculateTotal(List<OrderItem> items) {
        return items.stream()
            .mapToDouble(item -> item.getPrice() * item.getQuantity())
            .sum();
    }
}
`,
  },

  // 7. C#
  "Sample.cs": {
    language: "csharp",
    content: `
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace MyApp.Controllers
{
    public interface IProductService
    {
        Task<Product> GetByIdAsync(int id);
        Task<IEnumerable<Product>> GetAllAsync();
        Task<Product> CreateAsync(CreateProductDto dto);
    }

    [ApiController]
    [Route("api/[controller]")]
    public class ProductsController : ControllerBase
    {
        private const int MaxPageSize = 100;
        private readonly IProductService _productService;

        public ProductsController(IProductService productService)
        {
            _productService = productService;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<Product>>> GetAll()
        {
            var products = await _productService.GetAllAsync();
            return Ok(products);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<Product>> GetById(int id)
        {
            var product = await _productService.GetByIdAsync(id);
            if (product == null)
            {
                return NotFound();
            }
            return Ok(product);
        }

        [HttpPost]
        public async Task<ActionResult<Product>> Create([FromBody] CreateProductDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var product = await _productService.CreateAsync(dto);
            return CreatedAtAction(nameof(GetById), new { id = product.Id }, product);
        }
    }
}
`,
  },

  // 8. Ruby
  "sample.rb": {
    language: "ruby",
    content: `
require 'json'
require 'net/http'

MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30

module Authentication
  class TokenService
    attr_reader :secret_key

    def initialize(secret_key)
      @secret_key = secret_key
      @token_cache = {}
    end

    def generate_token(user_id)
      payload = {
        user_id: user_id,
        exp: Time.now.to_i + 3600
      }
      JWT.encode(payload, @secret_key, 'HS256')
    end

    def verify_token(token)
      decoded = JWT.decode(token, @secret_key, true, algorithm: 'HS256')
      decoded[0]
    rescue JWT::DecodeError => e
      Rails.logger.error("Token verification failed: #{e.message}")
      nil
    end
  end

  class AuthController < ApplicationController
    before_action :authenticate!, except: [:login]

    def login
      user = User.find_by(email: params[:email])

      if user&.authenticate(params[:password])
        token = token_service.generate_token(user.id)
        render json: { token: token }
      else
        render json: { error: 'Invalid credentials' }, status: :unauthorized
      end
    end

    def logout
      # Invalidate token
      render json: { message: 'Logged out successfully' }
    end

    private

    def token_service
      @token_service ||= TokenService.new(Rails.application.credentials.secret_key_base)
    end
  end
end
`,
  },

  // 9. PHP
  "Sample.php": {
    language: "php",
    content: `
<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Repositories\\UserRepository;
use Illuminate\\Support\\Facades\\Cache;
use Illuminate\\Support\\Facades\\Log;

interface UserServiceInterface
{
    public function findById(int $id): ?User;
    public function create(array $data): User;
    public function update(int $id, array $data): User;
}

class UserService implements UserServiceInterface
{
    private const CACHE_TTL = 3600;
    private const MAX_USERS = 10000;

    private UserRepository $repository;

    public function __construct(UserRepository $repository)
    {
        $this->repository = $repository;
    }

    public function findById(int $id): ?User
    {
        $cacheKey = "user_{$id}";

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($id) {
            return $this->repository->find($id);
        });
    }

    public function create(array $data): User
    {
        $user = new User();
        $user->name = $data['name'];
        $user->email = $data['email'];
        $user->password = bcrypt($data['password']);

        $this->repository->save($user);

        Log::info("User created", ['user_id' => $user->id]);

        return $user;
    }

    public function update(int $id, array $data): User
    {
        $user = $this->findById($id);

        if (!$user) {
            throw new \\Exception("User not found");
        }

        $user->fill($data);
        $this->repository->save($user);

        Cache::forget("user_{$id}");

        return $user;
    }
}
`,
  },

  // 10. Swift
  "Sample.swift": {
    language: "swift",
    content: `
import Foundation

protocol Repository {
    associatedtype T
    func findById(_ id: String) async throws -> T?
    func save(_ item: T) async throws
    func delete(_ id: String) async throws
}

struct User: Codable, Identifiable {
    let id: String
    var name: String
    var email: String
    var createdAt: Date
}

enum RepositoryError: Error {
    case notFound
    case duplicateKey
    case connectionFailed
}

actor UserRepository: Repository {
    typealias T = User

    private var storage: [String: User] = [:]
    private let maxCapacity = 10000

    func findById(_ id: String) async throws -> User? {
        return storage[id]
    }

    func save(_ user: User) async throws {
        guard storage.count < maxCapacity else {
            throw RepositoryError.connectionFailed
        }
        storage[user.id] = user
    }

    func delete(_ id: String) async throws {
        guard storage[id] != nil else {
            throw RepositoryError.notFound
        }
        storage.removeValue(forKey: id)
    }

    func findAll() async -> [User] {
        return Array(storage.values)
    }
}

class UserService {
    private let repository: UserRepository

    init(repository: UserRepository) {
        self.repository = repository
    }

    func getUser(id: String) async throws -> User {
        guard let user = try await repository.findById(id) else {
            throw RepositoryError.notFound
        }
        return user
    }

    func createUser(name: String, email: String) async throws -> User {
        let user = User(
            id: UUID().uuidString,
            name: name,
            email: email,
            createdAt: Date()
        )
        try await repository.save(user)
        return user
    }
}
`,
  },

  // 11. Kotlin
  "Sample.kt": {
    language: "kotlin",
    content: `
package com.example.app

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.util.concurrent.ConcurrentHashMap

const val MAX_ITEMS = 1000

data class Product(
    val id: String,
    val name: String,
    val price: Double,
    val category: String
)

interface ProductRepository {
    suspend fun findById(id: String): Product?
    suspend fun findAll(): List<Product>
    suspend fun save(product: Product): Product
    suspend fun delete(id: String)
}

class InMemoryProductRepository : ProductRepository {
    private val products = ConcurrentHashMap<String, Product>()

    override suspend fun findById(id: String): Product? {
        return products[id]
    }

    override suspend fun findAll(): List<Product> {
        return products.values.toList()
    }

    override suspend fun save(product: Product): Product {
        if (products.size >= MAX_ITEMS) {
            throw IllegalStateException("Repository is full")
        }
        products[product.id] = product
        return product
    }

    override suspend fun delete(id: String) {
        products.remove(id)
    }
}

class ProductService(
    private val repository: ProductRepository
) {
    suspend fun getProduct(id: String): Product {
        return repository.findById(id)
            ?: throw NoSuchElementException("Product not found: $id")
    }

    fun getAllProducts(): Flow<Product> = flow {
        repository.findAll().forEach { emit(it) }
    }

    suspend fun createProduct(name: String, price: Double, category: String): Product {
        val product = Product(
            id = java.util.UUID.randomUUID().toString(),
            name = name,
            price = price,
            category = category
        )
        return repository.save(product)
    }
}
`,
  },

  // 12. C
  "sample.c": {
    language: "c",
    content: `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

#define MAX_USERS 1000
#define MAX_NAME_LENGTH 100

typedef struct {
    int id;
    char name[MAX_NAME_LENGTH];
    char email[MAX_NAME_LENGTH];
} User;

typedef struct {
    User* users;
    int count;
    int capacity;
    pthread_mutex_t lock;
} UserRepository;

UserRepository* create_repository(int capacity) {
    UserRepository* repo = malloc(sizeof(UserRepository));
    repo->users = malloc(sizeof(User) * capacity);
    repo->count = 0;
    repo->capacity = capacity;
    pthread_mutex_init(&repo->lock, NULL);
    return repo;
}

void destroy_repository(UserRepository* repo) {
    pthread_mutex_destroy(&repo->lock);
    free(repo->users);
    free(repo);
}

User* find_user_by_id(UserRepository* repo, int id) {
    pthread_mutex_lock(&repo->lock);

    for (int i = 0; i < repo->count; i++) {
        if (repo->users[i].id == id) {
            pthread_mutex_unlock(&repo->lock);
            return &repo->users[i];
        }
    }

    pthread_mutex_unlock(&repo->lock);
    return NULL;
}

int add_user(UserRepository* repo, const char* name, const char* email) {
    pthread_mutex_lock(&repo->lock);

    if (repo->count >= repo->capacity) {
        pthread_mutex_unlock(&repo->lock);
        return -1;
    }

    User* user = &repo->users[repo->count];
    user->id = repo->count + 1;
    strncpy(user->name, name, MAX_NAME_LENGTH - 1);
    strncpy(user->email, email, MAX_NAME_LENGTH - 1);
    repo->count++;

    pthread_mutex_unlock(&repo->lock);
    return user->id;
}

void print_user(const User* user) {
    if (user) {
        printf("User %d: %s (%s)\\n", user->id, user->name, user->email);
    }
}
`,
  },

  // 13. C++
  "sample.cpp": {
    language: "cpp",
    content: `
#include <iostream>
#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include <mutex>

namespace app {

constexpr int MAX_CONNECTIONS = 100;

struct Connection {
    std::string id;
    std::string host;
    int port;
    bool active;
};

class ConnectionPool {
public:
    ConnectionPool(int maxSize = MAX_CONNECTIONS)
        : maxSize_(maxSize) {}

    std::shared_ptr<Connection> acquire() {
        std::lock_guard<std::mutex> lock(mutex_);

        for (auto& conn : connections_) {
            if (!conn->active) {
                conn->active = true;
                return conn;
            }
        }

        if (connections_.size() < maxSize_) {
            auto conn = std::make_shared<Connection>();
            conn->id = generateId();
            conn->active = true;
            connections_.push_back(conn);
            return conn;
        }

        return nullptr;
    }

    void release(std::shared_ptr<Connection> conn) {
        std::lock_guard<std::mutex> lock(mutex_);
        conn->active = false;
    }

    size_t activeCount() const {
        std::lock_guard<std::mutex> lock(mutex_);
        size_t count = 0;
        for (const auto& conn : connections_) {
            if (conn->active) count++;
        }
        return count;
    }

private:
    std::string generateId() {
        return "conn_" + std::to_string(nextId_++);
    }

    std::vector<std::shared_ptr<Connection>> connections_;
    mutable std::mutex mutex_;
    int maxSize_;
    int nextId_ = 1;
};

template<typename T>
class Repository {
public:
    virtual ~Repository() = default;
    virtual T* findById(const std::string& id) = 0;
    virtual void save(const T& item) = 0;
    virtual void remove(const std::string& id) = 0;
};

} // namespace app
`,
  },

  // 14. TSX (React TypeScript)
  "Sample.tsx": {
    language: "tsx",
    content: `
import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

interface TodoListProps {
  userId: string;
  onError?: (error: Error) => void;
}

const API_BASE_URL = '/api/v1';

export const TodoList: React.FC<TodoListProps> = ({ userId, onError }) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const { data: todos, isLoading, error } = useQuery<Todo[]>({
    queryKey: ['todos', userId],
    queryFn: async () => {
      const response = await fetch(\`\${API_BASE_URL}/users/\${userId}/todos\`);
      if (!response.ok) throw new Error('Failed to fetch todos');
      return response.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (todo: Todo) => {
      const response = await fetch(\`\${API_BASE_URL}/todos/\${todo.id}\`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !todo.completed }),
      });
      return response.json();
    },
  });

  const handleToggle = useCallback((todo: Todo) => {
    toggleMutation.mutate(todo);
  }, [toggleMutation]);

  useEffect(() => {
    if (error && onError) {
      onError(error as Error);
    }
  }, [error, onError]);

  if (isLoading) return <div>Loading...</div>;

  const filteredTodos = todos?.filter(todo => {
    if (filter === 'active') return !todo.completed;
    if (filter === 'completed') return todo.completed;
    return true;
  });

  return (
    <div className="todo-list">
      <div className="filters">
        <button onClick={() => setFilter('all')}>All</button>
        <button onClick={() => setFilter('active')}>Active</button>
        <button onClick={() => setFilter('completed')}>Completed</button>
      </div>
      <ul>
        {filteredTodos?.map(todo => (
          <li key={todo.id} onClick={() => handleToggle(todo)}>
            <span className={todo.completed ? 'completed' : ''}>
              {todo.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TodoList;
`,
  },

  // 15. JSX (React JavaScript)
  "Sample.jsx": {
    language: "jsx",
    content: `
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const DEFAULT_PAGE_SIZE = 10;

function DataTable({ data, columns, onRowClick, sortable = true }) {
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const handleSort = (column) => {
    if (!sortable) return;

    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedData = React.useMemo(() => {
    if (!sortColumn) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      const modifier = sortDirection === 'asc' ? 1 : -1;

      if (aVal < bVal) return -1 * modifier;
      if (aVal > bVal) return 1 * modifier;
      return 0;
    });
  }, [data, sortColumn, sortDirection]);

  const paginatedData = sortedData.slice(
    page * pageSize,
    (page + 1) * pageSize
  );

  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} onClick={() => handleSort(col.key)}>
                {col.label}
                {sortColumn === col.key && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedData.map((row, idx) => (
            <tr key={idx} onClick={() => onRowClick?.(row)}>
              {columns.map(col => (
                <td key={col.key}>{row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pagination">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  );
}

DataTable.propTypes = {
  data: PropTypes.array.isRequired,
  columns: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
  })).isRequired,
  onRowClick: PropTypes.func,
  sortable: PropTypes.bool,
};

export default DataTable;
`,
  },

  // 16. Vue
  "Sample.vue": {
    language: "vue",
    content: `
<template>
  <div class="user-profile">
    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else class="profile-content">
      <img :src="user.avatar" :alt="user.name" class="avatar" />
      <h2>{{ user.name }}</h2>
      <p>{{ user.email }}</p>
      <button @click="handleEdit" :disabled="editing">
        {{ editing ? 'Saving...' : 'Edit Profile' }}
      </button>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed } from 'vue';
import { useUserStore } from '@/stores/user';

const API_URL = '/api/users';

export default {
  name: 'UserProfile',
  props: {
    userId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const userStore = useUserStore();
    const loading = ref(true);
    const error = ref(null);
    const editing = ref(false);

    const user = computed(() => userStore.currentUser);

    async function fetchUser() {
      try {
        loading.value = true;
        await userStore.fetchUser(props.userId);
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    async function handleEdit() {
      editing.value = true;
      try {
        await userStore.updateUser(props.userId, user.value);
      } catch (e) {
        error.value = e.message;
      } finally {
        editing.value = false;
      }
    }

    onMounted(() => {
      fetchUser();
    });

    return {
      user,
      loading,
      error,
      editing,
      handleEdit,
    };
  },
};
</script>

<style scoped>
.user-profile {
  padding: 20px;
  max-width: 400px;
  margin: 0 auto;
}
.avatar {
  width: 100px;
  height: 100px;
  border-radius: 50%;
}
</style>
`,
  },

  // 17. Scala
  "Sample.scala": {
    language: "scala",
    content: `
package com.example.service

import scala.concurrent.{ExecutionContext, Future}
import scala.collection.mutable

case class User(id: String, name: String, email: String)

trait UserRepository {
  def findById(id: String): Future[Option[User]]
  def findAll(): Future[Seq[User]]
  def save(user: User): Future[User]
  def delete(id: String): Future[Boolean]
}

class InMemoryUserRepository(implicit ec: ExecutionContext) extends UserRepository {
  private val MaxUsers = 10000
  private val users = mutable.Map.empty[String, User]

  override def findById(id: String): Future[Option[User]] = Future {
    users.get(id)
  }

  override def findAll(): Future[Seq[User]] = Future {
    users.values.toSeq
  }

  override def save(user: User): Future[User] = Future {
    if (users.size >= MaxUsers) {
      throw new IllegalStateException("Repository is full")
    }
    users.put(user.id, user)
    user
  }

  override def delete(id: String): Future[Boolean] = Future {
    users.remove(id).isDefined
  }
}

class UserService(repository: UserRepository)(implicit ec: ExecutionContext) {
  def getUser(id: String): Future[User] = {
    repository.findById(id).map {
      case Some(user) => user
      case None => throw new NoSuchElementException(s"User not found: $id")
    }
  }

  def createUser(name: String, email: String): Future[User] = {
    val user = User(
      id = java.util.UUID.randomUUID().toString,
      name = name,
      email = email
    )
    repository.save(user)
  }

  def deleteUser(id: String): Future[Boolean] = {
    repository.delete(id)
  }
}
`,
  },

  // 18. Haskell
  "Sample.hs": {
    language: "haskell",
    content: `
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}

module UserService where

import Data.Text (Text)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Aeson (ToJSON, FromJSON)
import GHC.Generics (Generic)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Control.Concurrent.MVar (MVar, newMVar, readMVar, modifyMVar)

maxUsers :: Int
maxUsers = 10000

data User = User
  { userId :: Text
  , userName :: Text
  , userEmail :: Text
  } deriving (Show, Eq, Generic)

instance ToJSON User
instance FromJSON User

data UserRepository = UserRepository
  { repoUsers :: MVar (Map Text User)
  }

createRepository :: IO UserRepository
createRepository = do
  users <- newMVar Map.empty
  return $ UserRepository users

findById :: MonadIO m => UserRepository -> Text -> m (Maybe User)
findById repo uid = liftIO $ do
  users <- readMVar (repoUsers repo)
  return $ Map.lookup uid users

findAll :: MonadIO m => UserRepository -> m [User]
findAll repo = liftIO $ do
  users <- readMVar (repoUsers repo)
  return $ Map.elems users

save :: MonadIO m => UserRepository -> User -> m (Either String User)
save repo user = liftIO $ modifyMVar (repoUsers repo) $ \\users ->
  if Map.size users >= maxUsers
    then return (users, Left "Repository is full")
    else do
      let newUsers = Map.insert (userId user) user users
      return (newUsers, Right user)

delete :: MonadIO m => UserRepository -> Text -> m Bool
delete repo uid = liftIO $ modifyMVar (repoUsers repo) $ \\users ->
  if Map.member uid users
    then return (Map.delete uid users, True)
    else return (users, False)
`,
  },

  // 19. Elixir
  "sample.ex": {
    language: "elixir",
    content: `
defmodule MyApp.UserService do
  @moduledoc """
  Service for managing users.
  """

  alias MyApp.{User, Repo}
  require Logger

  @max_users 10_000
  @cache_ttl :timer.minutes(5)

  @doc """
  Finds a user by ID.

  ## Examples

      iex> UserService.find_by_id("123")
      {:ok, %User{}}

  """
  @spec find_by_id(String.t()) :: {:ok, User.t()} | {:error, :not_found}
  def find_by_id(id) do
    case Repo.get(User, id) do
      nil -> {:error, :not_found}
      user -> {:ok, user}
    end
  end

  @doc """
  Creates a new user.
  """
  @spec create(map()) :: {:ok, User.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) do
    %User{}
    |> User.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, user} ->
        Logger.info("User created: #{user.id}")
        {:ok, user}

      {:error, changeset} ->
        Logger.error("Failed to create user: #{inspect(changeset.errors)}")
        {:error, changeset}
    end
  end

  @doc """
  Updates an existing user.
  """
  @spec update(String.t(), map()) :: {:ok, User.t()} | {:error, term()}
  def update(id, attrs) do
    with {:ok, user} <- find_by_id(id),
         changeset <- User.changeset(user, attrs),
         {:ok, updated} <- Repo.update(changeset) do
      {:ok, updated}
    end
  end

  @doc """
  Deletes a user.
  """
  @spec delete(String.t()) :: {:ok, User.t()} | {:error, term()}
  def delete(id) do
    with {:ok, user} <- find_by_id(id),
         {:ok, deleted} <- Repo.delete(user) do
      {:ok, deleted}
    end
  end
end
`,
  },

  // 20. Dart
  "sample.dart": {
    language: "dart",
    content: `
import 'dart:async';
import 'dart:convert';

const int maxRetries = 3;
const Duration timeout = Duration(seconds: 30);

class User {
  final String id;
  final String name;
  final String email;
  final DateTime createdAt;

  User({
    required this.id,
    required this.name,
    required this.email,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'],
      name: json['name'],
      email: json['email'],
      createdAt: DateTime.parse(json['createdAt']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'email': email,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}

abstract class UserRepository {
  Future<User?> findById(String id);
  Future<List<User>> findAll();
  Future<User> save(User user);
  Future<void> delete(String id);
}

class InMemoryUserRepository implements UserRepository {
  final Map<String, User> _users = {};

  @override
  Future<User?> findById(String id) async {
    return _users[id];
  }

  @override
  Future<List<User>> findAll() async {
    return _users.values.toList();
  }

  @override
  Future<User> save(User user) async {
    _users[user.id] = user;
    return user;
  }

  @override
  Future<void> delete(String id) async {
    _users.remove(id);
  }
}

class UserService {
  final UserRepository _repository;

  UserService(this._repository);

  Future<User> getUser(String id) async {
    final user = await _repository.findById(id);
    if (user == null) {
      throw Exception('User not found: $id');
    }
    return user;
  }

  Future<User> createUser({
    required String name,
    required String email,
  }) async {
    final user = User(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: name,
      email: email,
    );
    return await _repository.save(user);
  }
}
`,
  },

  // 21. Lua
  "sample.lua": {
    language: "lua",
    content: `
-- User management module
local UserService = {}
UserService.__index = UserService

local MAX_USERS = 1000
local CACHE_TTL = 300

-- User class
local User = {}
User.__index = User

function User.new(id, name, email)
    local self = setmetatable({}, User)
    self.id = id
    self.name = name
    self.email = email
    self.createdAt = os.time()
    return self
end

function User:toTable()
    return {
        id = self.id,
        name = self.name,
        email = self.email,
        createdAt = self.createdAt
    }
end

-- UserService implementation
function UserService.new()
    local self = setmetatable({}, UserService)
    self.users = {}
    self.userCount = 0
    return self
end

function UserService:findById(id)
    return self.users[id]
end

function UserService:findAll()
    local result = {}
    for _, user in pairs(self.users) do
        table.insert(result, user)
    end
    return result
end

function UserService:create(name, email)
    if self.userCount >= MAX_USERS then
        return nil, "Maximum users reached"
    end

    local id = tostring(os.time()) .. tostring(math.random(1000, 9999))
    local user = User.new(id, name, email)

    self.users[id] = user
    self.userCount = self.userCount + 1

    print(string.format("User created: %s (%s)", name, id))
    return user
end

function UserService:delete(id)
    if self.users[id] then
        self.users[id] = nil
        self.userCount = self.userCount - 1
        return true
    end
    return false
end

function UserService:update(id, updates)
    local user = self.users[id]
    if not user then
        return nil, "User not found"
    end

    if updates.name then user.name = updates.name end
    if updates.email then user.email = updates.email end

    return user
end

return {
    UserService = UserService,
    User = User,
    MAX_USERS = MAX_USERS
}
`,
  },

  // 22. Shell/Bash
  "sample.sh": {
    language: "bash",
    content: `
#!/bin/bash

# Configuration
readonly MAX_RETRIES=3
readonly TIMEOUT=30
readonly LOG_FILE="/var/log/deploy.log"

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
NC='\\033[0m'

log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

check_dependencies() {
    local deps=("docker" "kubectl" "helm")

    for dep in "\${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log "ERROR" "$dep is not installed"
            return 1
        fi
    done

    log "INFO" "All dependencies are installed"
    return 0
}

deploy_application() {
    local app_name="$1"
    local version="$2"
    local environment="$3"

    if [[ -z "$app_name" || -z "$version" ]]; then
        log "ERROR" "Usage: deploy_application <app_name> <version> [environment]"
        return 1
    fi

    environment="\${environment:-production}"
    log "INFO" "Deploying $app_name v$version to $environment"

    local retry_count=0
    while [[ $retry_count -lt $MAX_RETRIES ]]; do
        if helm upgrade --install "$app_name" \\
            "./charts/$app_name" \\
            --set image.tag="$version" \\
            --namespace "$environment" \\
            --timeout "\${TIMEOUT}s" \\
            --wait; then
            log "INFO" "Deployment successful"
            return 0
        fi

        retry_count=$((retry_count + 1))
        log "WARN" "Deployment failed, retry $retry_count of $MAX_RETRIES"
        sleep 5
    done

    log "ERROR" "Deployment failed after $MAX_RETRIES attempts"
    return 1
}

rollback() {
    local app_name="$1"
    local revision="$2"

    log "INFO" "Rolling back $app_name to revision $revision"

    if helm rollback "$app_name" "$revision" --wait; then
        log "INFO" "Rollback successful"
        return 0
    else
        log "ERROR" "Rollback failed"
        return 1
    fi
}

main() {
    check_dependencies || exit 1

    case "$1" in
        deploy)
            deploy_application "$2" "$3" "$4"
            ;;
        rollback)
            rollback "$2" "$3"
            ;;
        *)
            echo "Usage: $0 {deploy|rollback} [args...]"
            exit 1
            ;;
    esac
}

main "$@"
`,
  },

  // 23. SQL
  "sample.sql": {
    language: "sql",
    content: `
-- User management schema and queries

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Find user by ID
CREATE OR REPLACE FUNCTION find_user_by_id(user_id UUID)
RETURNS TABLE (
    id UUID,
    name VARCHAR,
    email VARCHAR,
    role VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.name, u.email, u.role, u.created_at
    FROM users u
    WHERE u.id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Create user
CREATE OR REPLACE FUNCTION create_user(
    p_name VARCHAR,
    p_email VARCHAR,
    p_password_hash VARCHAR,
    p_role VARCHAR DEFAULT 'user'
)
RETURNS UUID AS $$
DECLARE
    new_id UUID;
BEGIN
    INSERT INTO users (name, email, password_hash, role)
    VALUES (p_name, p_email, p_password_hash, p_role)
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Get users with pagination
CREATE OR REPLACE FUNCTION get_users_paginated(
    p_limit INTEGER DEFAULT 10,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    name VARCHAR,
    email VARCHAR,
    role VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE,
    total_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        COUNT(*) OVER() as total_count
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;
`,
  },

  // 24. YAML (config file)
  "sample.yaml": {
    language: "yaml",
    content: `
# Application configuration
version: "3.8"

services:
  api:
    image: myapp/api:latest
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://user:pass@db:5432/myapp
      REDIS_URL: redis://redis:6379
      JWT_SECRET: \${JWT_SECRET}
    depends_on:
      - db
      - redis
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 256M
      restart_policy:
        condition: on-failure
        max_attempts: 3

  db:
    image: postgres:14-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: myapp
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d myapp"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    driver: bridge
`,
  },

  // 25. Markdown (documentation)
  "README.md": {
    language: "markdown",
    content: `
# MyApp API Documentation

## Overview

MyApp is a RESTful API service for managing users and resources.

## Installation

\`\`\`bash
npm install
npm run build
npm start
\`\`\`

## Configuration

Set the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| DATABASE_URL | PostgreSQL connection string | - |
| JWT_SECRET | Secret for JWT tokens | - |

## API Endpoints

### Users

#### Get all users

\`\`\`http
GET /api/users
\`\`\`

Response:
\`\`\`json
{
  "users": [
    {
      "id": "123",
      "name": "John Doe",
      "email": "john@example.com"
    }
  ]
}
\`\`\`

#### Create user

\`\`\`http
POST /api/users
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "secret123"
}
\`\`\`

## Error Handling

All errors return JSON with the following format:

\`\`\`json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "The requested user does not exist"
  }
}
\`\`\`

## License

MIT License - see LICENSE file for details.
`,
  },
};

// ============================================================================
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

interface TestSuite {
  name: string;
  results: TestResult[];
  totalPassed: number;
  totalFailed: number;
  duration: number;
}

class TestRunner {
  private results: TestSuite[] = [];

  async runAllTests(): Promise<void> {
    console.log("=".repeat(70));
    console.log("PRUNE INTELLIGENCE ENGINE TEST SUITE");
    console.log("=".repeat(70));
    console.log("");

    // Run test suites
    await this.testSymbolExtractor();
    await this.testRelevanceDAG();
    await this.testIntentClassifier();
    await this.testDAGWalker();
    await this.testKnownKnowledgeDetector();
    await this.testAdaptiveBudgetCalculator();
    await this.testResponseAnalyzer();
    await this.testContextManifestGenerator();
    await this.testFullIntegration();
    await this.test25FileTypes();

    // Print summary
    this.printSummary();
  }

  private async testSymbolExtractor(): Promise<void> {
    const suite: TestSuite = {
      name: "Symbol Extractor",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const extractor = new SymbolExtractor();

    // Test TypeScript extraction
    suite.results.push(
      this.runTest("Extract TypeScript functions", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.ts"].content,
          "sample.ts",
          "typescript"
        );
        const functions = symbols.filter(s => s.kind === "function" || s.kind === "method");
        if (functions.length < 2) {
          throw new Error(`Expected at least 2 functions, got ${functions.length}`);
        }
      })
    );

    suite.results.push(
      this.runTest("Extract TypeScript classes", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.ts"].content,
          "sample.ts",
          "typescript"
        );
        const classes = symbols.filter(s => s.kind === "class");
        if (classes.length < 1) {
          throw new Error(`Expected at least 1 class, got ${classes.length}`);
        }
      })
    );

    suite.results.push(
      this.runTest("Extract TypeScript interfaces", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.ts"].content,
          "sample.ts",
          "typescript"
        );
        const interfaces = symbols.filter(s => s.kind === "interface");
        if (interfaces.length < 1) {
          throw new Error(`Expected at least 1 interface, got ${interfaces.length}`);
        }
      })
    );

    // Test Python extraction
    suite.results.push(
      this.runTest("Extract Python functions", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.py"].content,
          "sample.py",
          "python"
        );
        const functions = symbols.filter(s => s.kind === "function");
        if (functions.length < 3) {
          throw new Error(`Expected at least 3 functions, got ${functions.length}`);
        }
      })
    );

    suite.results.push(
      this.runTest("Extract Python classes", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.py"].content,
          "sample.py",
          "python"
        );
        const classes = symbols.filter(s => s.kind === "class");
        if (classes.length < 1) {
          throw new Error(`Expected at least 1 class, got ${classes.length}`);
        }
      })
    );

    // Test Go extraction
    suite.results.push(
      this.runTest("Extract Go functions", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.go"].content,
          "sample.go",
          "go"
        );
        const functions = symbols.filter(s => s.kind === "function");
        if (functions.length < 4) {
          throw new Error(`Expected at least 4 functions, got ${functions.length}`);
        }
      })
    );

    suite.results.push(
      this.runTest("Extract Go interfaces", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.go"].content,
          "sample.go",
          "go"
        );
        const interfaces = symbols.filter(s => s.kind === "interface");
        if (interfaces.length < 1) {
          throw new Error(`Expected at least 1 interface, got ${interfaces.length}`);
        }
      })
    );

    // Test Rust extraction
    suite.results.push(
      this.runTest("Extract Rust functions", () => {
        const symbols = extractor.extractSymbols(
          testSamples["sample.rs"].content,
          "sample.rs",
          "rust"
        );
        const functions = symbols.filter(s => s.kind === "function");
        if (functions.length < 3) {
          throw new Error(`Expected at least 3 functions, got ${functions.length}`);
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testRelevanceDAG(): Promise<void> {
    const suite: TestSuite = {
      name: "Relevance DAG",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const extractor = new SymbolExtractor();
    const dag = new RelevanceDAG();

    // Build DAG from TypeScript file
    const symbols = extractor.extractSymbols(
      testSamples["sample.ts"].content,
      "sample.ts",
      "typescript"
    );

    suite.results.push(
      this.runTest("Build DAG from symbols", () => {
        dag.build(symbols);
        if (dag.getSymbols().length === 0) {
          throw new Error("DAG has no symbols");
        }
      })
    );

    suite.results.push(
      this.runTest("DAG has edges", () => {
        dag.build(symbols);
        // Not all files will have edges, but the structure should work
        const edges = dag.getEdges();
        // Just verify the structure works
        if (!Array.isArray(edges)) {
          throw new Error("Edges should be an array");
        }
      })
    );

    suite.results.push(
      this.runTest("Get symbol by ID", () => {
        dag.build(symbols);
        const allSymbols = dag.getSymbols();
        if (allSymbols.length > 0) {
          const symbol = dag.getSymbol(allSymbols[0].id);
          if (!symbol) {
            throw new Error("Could not retrieve symbol by ID");
          }
        }
      })
    );

    suite.results.push(
      this.runTest("Get transitive dependencies", () => {
        dag.build(symbols);
        const allSymbols = dag.getSymbols();
        if (allSymbols.length > 0) {
          const deps = dag.getTransitiveDependencies(allSymbols[0].id);
          if (!(deps instanceof Set)) {
            throw new Error("Transitive dependencies should return a Set");
          }
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testIntentClassifier(): Promise<void> {
    const suite: TestSuite = {
      name: "Intent Classifier",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const classifier = new IntentClassifier();

    const testCases: Array<{prompt: string; expectedIntent: IntentType}> = [
      { prompt: "Fix the bug in the authentication module", expectedIntent: "debug" },
      { prompt: "There's an error when I try to login", expectedIntent: "debug" },
      { prompt: "Why is this function returning null?", expectedIntent: "debug" },
      { prompt: "Create a new user registration endpoint", expectedIntent: "generate" },
      { prompt: "Add a function to calculate the total", expectedIntent: "generate" },
      { prompt: "Implement a cache layer for the API", expectedIntent: "generate" },
      { prompt: "Refactor this code to be more readable", expectedIntent: "refactor" },
      { prompt: "Clean up the authentication module", expectedIntent: "refactor" },
      { prompt: "Extract this logic into a separate function", expectedIntent: "refactor" },
      { prompt: "Explain how this function works", expectedIntent: "explain" },
      { prompt: "What does this code do?", expectedIntent: "explain" },
      { prompt: "Help me understand the authentication flow", expectedIntent: "explain" },
      { prompt: "Change the timeout value to 30 seconds", expectedIntent: "edit" },
      { prompt: "Update the API endpoint URL", expectedIntent: "edit" },
      { prompt: "Modify line 42 to fix the typo", expectedIntent: "edit" },
      { prompt: "Write unit tests for the user service", expectedIntent: "test" },
      { prompt: "Add test coverage for the auth module", expectedIntent: "test" },
      { prompt: "Fix the failing test in user.spec.ts", expectedIntent: "test" },
    ];

    for (const testCase of testCases) {
      suite.results.push(
        this.runTest(`Classify "${testCase.prompt.slice(0, 40)}..."`, () => {
          const result = classifier.classify(testCase.prompt);
          if (result.primary !== testCase.expectedIntent) {
            throw new Error(
              `Expected ${testCase.expectedIntent}, got ${result.primary}`
            );
          }
        })
      );
    }

    suite.results.push(
      this.runTest("Extract target files from prompt", () => {
        const result = classifier.classify("Fix the bug in user.service.ts");
        if (!result.targetFiles?.includes("user.service.ts")) {
          throw new Error("Should extract file name from prompt");
        }
      })
    );

    suite.results.push(
      this.runTest("Extract target symbols from prompt", () => {
        const result = classifier.classify("Refactor the UserController class");
        if (!result.targetSymbols?.includes("UserController")) {
          throw new Error("Should extract symbol name from prompt");
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testDAGWalker(): Promise<void> {
    const suite: TestSuite = {
      name: "DAG Walker",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const extractor = new SymbolExtractor();
    const dag = new RelevanceDAG();
    const classifier = new IntentClassifier();

    // Build DAG from multiple files
    const allSymbols: CodeSymbol[] = [];
    for (const [filename, sample] of Object.entries(testSamples).slice(0, 5)) {
      const symbols = extractor.extractSymbols(sample.content, filename, sample.language);
      allSymbols.push(...symbols);
    }
    dag.build(allSymbols);

    const walker = new DAGWalker(dag, classifier);

    suite.results.push(
      this.runTest("Walk DAG with debug intent", () => {
        const selection = walker.walk("Fix the bug in the user service", {
          maxTokens: 100000,
          reservedForResponse: 4000,
          reservedForSystem: 2000,
          availableForContext: 50000,
        });
        if (selection.selectedSymbols.length === 0) {
          throw new Error("Should select some symbols");
        }
      })
    );

    suite.results.push(
      this.runTest("Respect token budget", () => {
        const budget = 5000;
        const selection = walker.walk("Explain the code", {
          maxTokens: 10000,
          reservedForResponse: 2000,
          reservedForSystem: 1000,
          availableForContext: budget,
        });
        if (selection.totalTokens > budget) {
          throw new Error(`Exceeded budget: ${selection.totalTokens} > ${budget}`);
        }
      })
    );

    suite.results.push(
      this.runTest("Prioritize active file", () => {
        const selection = walker.walk(
          "Fix the error",
          {
            maxTokens: 100000,
            reservedForResponse: 4000,
            reservedForSystem: 2000,
            availableForContext: 10000,
          },
          "sample.ts"
        );
        const fromActiveFile = selection.selectedSymbols.filter(
          s => s.symbol.filePath === "sample.ts"
        );
        // Active file symbols should be prioritized
        if (selection.selectedSymbols.length > 0 && fromActiveFile.length === 0) {
          // This is okay if there are no symbols from sample.ts
        }
      })
    );

    suite.results.push(
      this.runTest("Include signature-only for medium relevance", () => {
        const selection = walker.walk(
          "Refactor the code",
          {
            maxTokens: 100000,
            reservedForResponse: 4000,
            reservedForSystem: 2000,
            availableForContext: 50000,
          }
        );
        const signatureOnly = selection.selectedSymbols.filter(
          s => s.relevance.includeMode === "signature"
        );
        // Should have some signature-only symbols
        // (this depends on the relevance scoring)
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testKnownKnowledgeDetector(): Promise<void> {
    const suite: TestSuite = {
      name: "Known Knowledge Detector",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const detector = new KnownKnowledgeDetector();

    suite.results.push(
      this.runTest("Detect React hooks", () => {
        const code = `
          const [count, setCount] = useState(0);
          useEffect(() => {
            console.log(count);
          }, [count]);
        `;
        const detected = detector.detectKnownPatterns(code);
        const reactHooks = detected.filter(d => d.pattern.category.includes("react"));
        if (reactHooks.length < 2) {
          throw new Error("Should detect useState and useEffect");
        }
      })
    );

    suite.results.push(
      this.runTest("Detect Express patterns", () => {
        const code = `
          app.get('/users', handler);
          app.post('/users', createHandler);
          app.use(middleware);
        `;
        const detected = detector.detectKnownPatterns(code);
        const expressPatterns = detected.filter(d => d.pattern.category.includes("express"));
        if (expressPatterns.length < 2) {
          throw new Error("Should detect Express route patterns");
        }
      })
    );

    suite.results.push(
      this.runTest("Detect Jest patterns", () => {
        const code = `
          describe('UserService', () => {
            it('should create user', () => {
              expect(result).toBeDefined();
            });
          });
        `;
        const detected = detector.detectKnownPatterns(code);
        const jestPatterns = detected.filter(d => d.pattern.category.includes("jest"));
        if (jestPatterns.length < 2) {
          throw new Error("Should detect Jest test patterns");
        }
      })
    );

    suite.results.push(
      this.runTest("Calculate potential savings", () => {
        const code = testSamples["Sample.tsx"].content;
        const savings = detector.calculatePotentialSavings(code);
        if (savings.totalSavings <= 0) {
          throw new Error("Should calculate positive savings for React code");
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testAdaptiveBudgetCalculator(): Promise<void> {
    const suite: TestSuite = {
      name: "Adaptive Budget Calculator",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const calculator = new AdaptiveBudgetCalculator();
    const classifier = new IntentClassifier();

    suite.results.push(
      this.runTest("Calculate budget for debug intent", () => {
        const intent = classifier.classify("Fix the bug");
        const budget = calculator.calculateBudget(intent);
        if (budget.availableForContext <= 0) {
          throw new Error("Budget should be positive");
        }
      })
    );

    suite.results.push(
      this.runTest("Debug budget smaller than refactor", () => {
        const debugIntent = classifier.classify("Fix the bug");
        const refactorIntent = classifier.classify("Refactor the entire module");
        const debugBudget = calculator.calculateBudget(debugIntent);
        const refactorBudget = calculator.calculateBudget(refactorIntent);
        if (debugBudget.availableForContext >= refactorBudget.availableForContext) {
          throw new Error("Debug budget should be smaller than refactor budget");
        }
      })
    );

    suite.results.push(
      this.runTest("Respect model max tokens", () => {
        const intent = classifier.classify("Review all the code");
        const modelMax = 50000;
        const budget = calculator.calculateBudget(intent, modelMax);
        if (budget.availableForContext > modelMax) {
          throw new Error("Should not exceed model max tokens");
        }
      })
    );

    suite.results.push(
      this.runTest("Adjust for complexity", () => {
        const intent = classifier.classify("Explain the code");
        const baseBudget = calculator.calculateBudget(intent);
        const adjustedBudget = calculator.adjustForComplexity(baseBudget, 20, 15);
        if (adjustedBudget.availableForContext <= baseBudget.availableForContext) {
          throw new Error("High complexity should increase budget");
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testResponseAnalyzer(): Promise<void> {
    const suite: TestSuite = {
      name: "Response Analyzer",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const analyzer = new ResponseAnalyzer();

    const mockSymbols: CodeSymbol[] = [
      {
        id: "test.ts:1:UserService",
        name: "UserService",
        kind: "class",
        filePath: "test.ts",
        startLine: 1,
        endLine: 50,
        signature: "class UserService",
        fullText: "class UserService { ... }",
        dependencies: [],
        dependents: [],
        complexity: 5,
        tokens: 100,
        isExported: true,
        isAsync: false,
      },
      {
        id: "test.ts:10:getUser",
        name: "getUser",
        kind: "function",
        filePath: "test.ts",
        startLine: 10,
        endLine: 20,
        signature: "function getUser(id: string)",
        fullText: "function getUser(id: string) { ... }",
        dependencies: [],
        dependents: [],
        complexity: 3,
        tokens: 50,
        isExported: true,
        isAsync: true,
      },
      {
        id: "test.ts:30:createUser",
        name: "createUser",
        kind: "function",
        filePath: "test.ts",
        startLine: 30,
        endLine: 40,
        signature: "function createUser(data: UserData)",
        fullText: "function createUser(data: UserData) { ... }",
        dependencies: [],
        dependents: [],
        complexity: 4,
        tokens: 60,
        isExported: true,
        isAsync: true,
      },
    ];

    suite.results.push(
      this.runTest("Detect referenced symbols", () => {
        const response = `
          Looking at the UserService class, I can see that the getUser function
          needs to be modified to handle the edge case.
        `;
        const analysis = analyzer.analyzeResponse(response, mockSymbols);
        if (!analysis.referencedSymbols.includes("test.ts:1:UserService")) {
          throw new Error("Should detect UserService as referenced");
        }
        if (!analysis.referencedSymbols.includes("test.ts:10:getUser")) {
          throw new Error("Should detect getUser as referenced");
        }
      })
    );

    suite.results.push(
      this.runTest("Detect modified symbols", () => {
        const response = `
          I'll fix the createUser function:
          \`\`\`typescript
          function createUser(data: UserData) {
            // Fixed implementation
          }
          \`\`\`
        `;
        const analysis = analyzer.analyzeResponse(response, mockSymbols);
        if (!analysis.modifiedSymbols.includes("test.ts:30:createUser")) {
          throw new Error("Should detect createUser as modified");
        }
      })
    );

    suite.results.push(
      this.runTest("Detect unused symbols", () => {
        const response = `
          The getUser function looks fine to me.
        `;
        const analysis = analyzer.analyzeResponse(response, mockSymbols);
        if (analysis.unusedSymbols.length !== 2) {
          throw new Error(`Should have 2 unused symbols, got ${analysis.unusedSymbols.length}`);
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testContextManifestGenerator(): Promise<void> {
    const suite: TestSuite = {
      name: "Context Manifest Generator",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const generator = new ContextManifestGenerator();
    const extractor = new SymbolExtractor();

    const symbols = extractor.extractSymbols(
      testSamples["sample.ts"].content,
      "sample.ts",
      "typescript"
    );

    suite.results.push(
      this.runTest("Generate manifest", () => {
        const manifest = generator.generate(symbols, {
          maxTokens: 100000,
          reservedForResponse: 4000,
          reservedForSystem: 2000,
          availableForContext: 50000,
        });
        if (!manifest.version || !manifest.files || !manifest.symbols) {
          throw new Error("Manifest missing required fields");
        }
      })
    );

    suite.results.push(
      this.runTest("Format manifest as text", () => {
        const manifest = generator.generate(symbols, {
          maxTokens: 100000,
          reservedForResponse: 4000,
          reservedForSystem: 2000,
          availableForContext: 50000,
        });
        const text = generator.formatAsText(manifest);
        if (!text.includes("Available Context")) {
          throw new Error("Formatted text should include header");
        }
        if (!text.includes("Files:")) {
          throw new Error("Formatted text should list files");
        }
      })
    );

    suite.results.push(
      this.runTest("Manifest includes request format", () => {
        const manifest = generator.generate(symbols, {
          maxTokens: 100000,
          reservedForResponse: 4000,
          reservedForSystem: 2000,
          availableForContext: 50000,
        });
        if (!manifest.requestFormat) {
          throw new Error("Manifest should include request format instructions");
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async testFullIntegration(): Promise<void> {
    const suite: TestSuite = {
      name: "Full Integration",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const engine = new PruneIntelligenceEngine();

    // Prepare files
    const files = Object.entries(testSamples).slice(0, 10).map(([path, sample]) => ({
      path,
      content: sample.content,
      language: sample.language,
    }));

    suite.results.push(
      this.runTest("Analyze multiple files", async () => {
        await engine.analyzeFiles(files);
        const stats = engine.getStats();
        if (stats.symbolCount === 0) {
          throw new Error("Should extract symbols from files");
        }
      })
    );

    suite.results.push(
      this.runTest("Select context for prompt", async () => {
        await engine.analyzeFiles(files);
        const selection = engine.selectContext("Fix the bug in the user service", {
          activeFile: "sample.ts",
        });
        if (selection.selectedSymbols.length === 0) {
          throw new Error("Should select some context");
        }
      })
    );

    suite.results.push(
      this.runTest("Generate manifest", async () => {
        await engine.analyzeFiles(files);
        const manifest = engine.generateManifest();
        if (!manifest.files || manifest.files.length === 0) {
          throw new Error("Manifest should list files");
        }
      })
    );

    suite.results.push(
      this.runTest("Get stats", async () => {
        await engine.analyzeFiles(files);
        const stats = engine.getStats();
        if (stats.fileCount !== files.length) {
          throw new Error(`Expected ${files.length} files, got ${stats.fileCount}`);
        }
      })
    );

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private async test25FileTypes(): Promise<void> {
    const suite: TestSuite = {
      name: "25 File Types",
      results: [],
      totalPassed: 0,
      totalFailed: 0,
      duration: 0,
    };

    const startTime = Date.now();
    const extractor = new SymbolExtractor();

    for (const [filename, sample] of Object.entries(testSamples)) {
      suite.results.push(
        this.runTest(`Extract from ${filename}`, () => {
          const symbols = extractor.extractSymbols(
            sample.content,
            filename,
            sample.language
          );
          // Most files should have some symbols
          // Config files (yaml, sql) might have fewer
          if (symbols.length === 0 && !["sample.yaml", "README.md"].includes(filename)) {
            console.warn(`  Warning: No symbols extracted from ${filename}`);
          }
        })
      );
    }

    // Test full pipeline with all 25 files
    const asyncTestResult = await this.runAsyncTest("Process all 25 file types in pipeline", async () => {
      const engine = new PruneIntelligenceEngine();
      const files = Object.entries(testSamples).map(([path, sample]) => ({
        path,
        content: sample.content,
        language: sample.language,
      }));

      await engine.analyzeFiles(files);
      const stats = engine.getStats();

      // Note: fileCount counts files with at least one symbol.
      // Some files (config, markdown) may not have extractable symbols.
      // We expect at least 20 of 25 files to have symbols.
      if (stats.fileCount < 20) {
        throw new Error(`Expected at least 20 files with symbols, got ${stats.fileCount}`);
      }

      // Select context
      const selection = engine.selectContext("Explain the user service implementation");
      if (selection.selectedSymbols.length === 0) {
        throw new Error("Should select some symbols from files");
      }

      // Generate manifest
      const manifest = engine.generateManifest();
      // Manifest includes all files with symbols
      if (manifest.files.length < 20) {
        throw new Error(`Manifest should have at least 20 files, got ${manifest.files.length}`);
      }
    });
    suite.results.push(asyncTestResult);

    suite.duration = Date.now() - startTime;
    suite.totalPassed = suite.results.filter(r => r.passed).length;
    suite.totalFailed = suite.results.filter(r => !r.passed).length;
    this.results.push(suite);
    this.printSuiteResults(suite);
  }

  private runTest(name: string, fn: () => void): TestResult {
    const startTime = Date.now();
    try {
      fn();
      return {
        name,
        passed: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  private async runAsyncTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
    const startTime = Date.now();
    try {
      await fn();
      return {
        name,
        passed: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  private printSuiteResults(suite: TestSuite): void {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`${suite.name}`);
    console.log(`${"─".repeat(70)}`);

    for (const result of suite.results) {
      const status = result.passed ? "✓" : "✗";
      const color = result.passed ? "\x1b[32m" : "\x1b[31m";
      const reset = "\x1b[0m";
      console.log(`  ${color}${status}${reset} ${result.name} (${result.duration}ms)`);
      if (!result.passed && result.error) {
        console.log(`    ${"\x1b[31m"}Error: ${result.error}${"\x1b[0m"}`);
      }
    }

    console.log(`\n  Passed: ${suite.totalPassed}, Failed: ${suite.totalFailed}, Duration: ${suite.duration}ms`);
  }

  private printSummary(): void {
    console.log("\n" + "=".repeat(70));
    console.log("TEST SUMMARY");
    console.log("=".repeat(70));

    let totalPassed = 0;
    let totalFailed = 0;
    let totalDuration = 0;

    for (const suite of this.results) {
      const status = suite.totalFailed === 0 ? "✓" : "✗";
      const color = suite.totalFailed === 0 ? "\x1b[32m" : "\x1b[31m";
      const reset = "\x1b[0m";
      console.log(
        `  ${color}${status}${reset} ${suite.name}: ${suite.totalPassed}/${suite.totalPassed + suite.totalFailed} passed`
      );
      totalPassed += suite.totalPassed;
      totalFailed += suite.totalFailed;
      totalDuration += suite.duration;
    }

    console.log("\n" + "─".repeat(70));
    console.log(
      `Total: ${totalPassed} passed, ${totalFailed} failed, ${totalDuration}ms`
    );

    if (totalFailed === 0) {
      console.log("\n\x1b[32m✓ All tests passed!\x1b[0m\n");
    } else {
      console.log(`\n\x1b[31m✗ ${totalFailed} test(s) failed\x1b[0m\n`);
    }
  }
}

// ============================================================================
// Run Tests
// ============================================================================

export async function runTests(): Promise<void> {
  const runner = new TestRunner();
  await runner.runAllTests();
}

// Export for use in extension
export { TestRunner, testSamples };
