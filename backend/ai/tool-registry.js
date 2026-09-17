/**
 * HELIX AI Engineering Operating System — Tool Registry & Permissions
 * Provides permissioned, sandboxed tools for agents (virtual file workspace,
 * syntax validation, security analysis, test running).
 */

import { AGENT_CONTRACTS } from './contracts.js';

export class ToolPermissionError extends Error {
  constructor(agentRole, toolName) {
    super(`Agent "${agentRole}" is not authorized to execute tool "${toolName}".`);
    this.name = 'ToolPermissionError';
    this.agentRole = agentRole;
    this.toolName = toolName;
  }
}

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.virtualFiles = new Map(); // projectId -> Map(filePath -> content)

    this.registerCoreTools();
  }

  registerCoreTools() {
    // 1. Virtual workspace write tool
    this.registerTool('virtual_workspace_write', async ({ projectId, filePath, content }) => {
      if (!this.virtualFiles.has(projectId)) {
        this.virtualFiles.set(projectId, new Map());
      }
      this.virtualFiles.get(projectId).set(filePath, content);
      return { success: true, path: filePath, bytes: content.length };
    });

    // 2. Virtual workspace read tool
    this.registerTool('virtual_workspace_read', async ({ projectId, filePath }) => {
      const files = this.virtualFiles.get(projectId);
      if (!files || !files.has(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      return { success: true, path: filePath, content: files.get(filePath) };
    });

    // 3. Syntax validation tool
    this.registerTool('syntax_validate', async ({ language, code }) => {
      const lang = String(language).toLowerCase();
      const errors = [];

      if (lang === 'json') {
        try {
          JSON.parse(code);
        } catch (e) {
          errors.push(`JSON Syntax Error: ${e.message}`);
        }
      } else if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
        // Quick syntax sanity checks for unmatched brackets/parens/quotes
        const checkBrackets = (str) => {
          const stack = [];
          const map = { '}': '{', ')': '(', ']': '[' };
          for (const char of str) {
            if (['{', '(', '['].includes(char)) stack.push(char);
            else if (['}', ')', ']'].includes(char)) {
              if (stack.pop() !== map[char]) return false;
            }
          }
          return stack.length === 0;
        };

        if (!checkBrackets(code)) {
          errors.push('Unbalanced brackets or parenthesis in code snippet.');
        }
      } else if (lang === 'sql') {
        if (!code.trim().toUpperCase().includes('CREATE') && !code.trim().toUpperCase().includes('SELECT') && !code.trim().toUpperCase().includes('ALTER')) {
          errors.push('SQL statement does not contain a recognized DDL or DML command.');
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    });

    // 4. Security analyzer tool
    this.registerTool('security_analyzer', async ({ code, filePath }) => {
      const findings = [];

      // Check for hardcoded API keys/passwords
      if (/(?:api[_-]?key|secret|password|bearer)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/i.test(code)) {
        findings.push({
          rule: 'HARDCODED_SECRET',
          severity: 'Critical',
          message: 'Possible hardcoded secret or token detected.',
          file: filePath,
        });
      }

      // Check for eval or dynamic execution
      if (/\beval\s*\(|new\s+Function\s*\(/i.test(code)) {
        findings.push({
          rule: 'UNSAFE_EVAL',
          severity: 'Critical',
          message: 'Execution of arbitrary code using eval() or Function constructor.',
          file: filePath,
        });
      }

      // Check for raw unparameterized SQL concatenation
      if (/SELECT\s+.*FROM.*WHERE.*\+\s*[a-zA-Z_]/i.test(code) || /query\s*\(\s*`.*WHERE.*\$\{/i.test(code)) {
        findings.push({
          rule: 'SQL_INJECTION',
          severity: 'High',
          message: 'Potential SQL injection: string interpolation detected in query.',
          file: filePath,
        });
      }

      return {
        scanned: true,
        findingsCount: findings.length,
        findings,
      };
    });

    // 5. Test runner tool
    this.registerTool('test_runner', async ({ testSuiteName, assertions = [] }) => {
      const results = assertions.map((a, idx) => ({
        id: `assertion-${idx + 1}`,
        description: a.description || `Test case ${idx + 1}`,
        passed: a.passed !== false,
      }));

      const passedCount = results.filter((r) => r.passed).length;
      return {
        suite: testSuiteName || 'Default Suite',
        total: results.length,
        passed: passedCount,
        failed: results.length - passedCount,
        status: results.length === passedCount ? 'PASS' : 'FAIL',
        results,
      };
    });
  }

  registerTool(name, handler) {
    this.tools.set(name, handler);
  }

  /**
   * Checks if an agent role is authorized to execute the tool.
   */
  isAuthorized(agentRole, toolName) {
    const contract = AGENT_CONTRACTS[agentRole];
    if (!contract || !Array.isArray(contract.tools)) return false;
    return contract.tools.includes(toolName);
  }

  /**
   * Executes a tool with permission enforcement.
   */
  async executeTool(agentRole, toolName, args = {}) {
    if (!this.isAuthorized(agentRole, toolName)) {
      throw new ToolPermissionError(agentRole, toolName);
    }

    const handler = this.tools.get(toolName);
    if (!handler) {
      throw new Error(`Tool "${toolName}" not found in registry.`);
    }

    return handler(args);
  }
}
