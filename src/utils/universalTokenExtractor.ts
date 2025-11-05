/**
 * Universal Token Extractor
 * 
 * Automatically detects and extracts token usage from ANY provider's response
 * without needing provider-specific logic or configuration.
 * 
 * Features:
 * - Deep object traversal to find token fields
 * - Pattern matching for token-related keys
 * - Automatic field name detection
 * - Learning from successful extractions
 * - Fallback to text estimation
 */

export interface TokenExtractionResult {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  detectedFields?: {
    inputField?: string;
    outputField?: string;
    totalField?: string;
  };
}

export interface ExtractionPattern {
  inputPatterns: string[];
  outputPatterns: string[];
  totalPatterns: string[];
  usageContainers: string[];
}

class UniversalTokenExtractor {
  // Known patterns for token field names (comprehensive list)
  private readonly TOKEN_PATTERNS: ExtractionPattern = {
    // Input token patterns (40+ variations)
    inputPatterns: [
      'input_tokens', 'inputTokens', 'input_token_count', 'inputTokenCount',
      'prompt_tokens', 'promptTokens', 'prompt_token_count', 'promptTokenCount',
      'num_prompt_tokens', 'numPromptTokens', 'num_input_tokens', 'numInputTokens',
      'prompt_count', 'promptCount', 'input_count', 'inputCount',
      'tokens_prompt', 'tokensPrompt', 'tokens_input', 'tokensInput',
      'request_tokens', 'requestTokens', 'query_tokens', 'queryTokens',
      'encoder_tokens', 'encoderTokens', 'context_tokens', 'contextTokens',
      'prefill_tokens', 'prefillTokens', 'cached_tokens', 'cachedTokens',
      'prompt', 'input', 'request', 'query', 'encoder', 'context',
      'in_tokens', 'inTokens', 'tokens_in', 'tokensIn'
    ],

    // Output token patterns (40+ variations)
    outputPatterns: [
      'output_tokens', 'outputTokens', 'output_token_count', 'outputTokenCount',
      'completion_tokens', 'completionTokens', 'completion_token_count', 'completionTokenCount',
      'num_completion_tokens', 'numCompletionTokens', 'num_output_tokens', 'numOutputTokens',
      'completion_count', 'completionCount', 'output_count', 'outputCount',
      'tokens_completion', 'tokensCompletion', 'tokens_output', 'tokensOutput',
      'response_tokens', 'responseTokens', 'answer_tokens', 'answerTokens',
      'decoder_tokens', 'decoderTokens', 'generated_tokens', 'generatedTokens',
      'generation_tokens', 'generationTokens', 'decode_tokens', 'decodeTokens',
      'completion', 'output', 'response', 'answer', 'decoder', 'generated',
      'out_tokens', 'outTokens', 'tokens_out', 'tokensOut',
      'candidates_token_count', 'candidatesTokenCount', 'max_output_tokens', 'maxOutputTokens'
    ],

    // Total token patterns (20+ variations)
    totalPatterns: [
      'total_tokens', 'totalTokens', 'total_token_count', 'totalTokenCount',
      'num_total_tokens', 'numTotalTokens', 'tokens_total', 'tokensTotal',
      'all_tokens', 'allTokens', 'combined_tokens', 'combinedTokens',
      'token_count', 'tokenCount', 'tokens', 'count',
      'total', 'sum_tokens', 'sumTokens'
    ],

    // Common containers for usage data (30+ variations)
    usageContainers: [
      'usage', 'token_usage', 'tokenUsage', 'tokens',
      'usage_metadata', 'usageMetadata', 'metadata', 'meta',
      'statistics', 'stats', 'metrics', 'counts',
      'token_info', 'tokenInfo', 'token_data', 'tokenData',
      'billing', 'cost', 'consumption', 'utilization',
      'token_counts', 'tokenCounts', 'count_info', 'countInfo',
      'usage_info', 'usageInfo', 'usage_data', 'usageData',
      'result', 'data', 'response_metadata', 'responseMetadata'
    ]
  };

  // Learned patterns from successful extractions
  private learnedPatterns: Map<string, string[]> = new Map();

  /**
   * Extract tokens from any provider's response
   * Uses multiple strategies with fallback
   */
  extract(response: any, provider?: string): TokenExtractionResult {
    // Strategy 1: Try learned patterns for this provider
    if (provider && this.learnedPatterns.has(provider)) {
      const result = this.extractUsingLearnedPatterns(response, provider);
      if (result && result.confidence !== 'low') {
        return result;
      }
    }

    // Strategy 2: Deep search for token fields
    const deepResult = this.deepExtract(response);
    if (deepResult && deepResult.confidence !== 'low') {
      // Learn this pattern for future use
      if (provider && deepResult.detectedFields) {
        this.learnPattern(provider, deepResult.detectedFields);
      }
      return deepResult;
    }

    // Strategy 3: Pattern matching in known containers
    const containerResult = this.extractFromContainers(response);
    if (containerResult && containerResult.confidence !== 'low') {
      if (provider && containerResult.detectedFields) {
        this.learnPattern(provider, containerResult.detectedFields);
      }
      return containerResult;
    }

    // Strategy 4: Fuzzy matching (check for similar field names)
    const fuzzyResult = this.fuzzyExtract(response);
    if (fuzzyResult && fuzzyResult.confidence !== 'low') {
      return fuzzyResult;
    }

    // Strategy 5: Extract from response text (last resort estimation)
    const textResult = this.extractFromText(response);
    return textResult;
  }

  /**
   * Deep traversal of response object to find token fields
   */
  private deepExtract(obj: any, depth: number = 0, maxDepth: number = 5): TokenExtractionResult | null {
    if (!obj || typeof obj !== 'object' || depth > maxDepth) {
      return null;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let detectedFields: any = {};

    // Check current level for token fields
    const keys = Object.keys(obj);
    
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      const value = obj[key];

      // Check if this is a number (potential token count)
      if (typeof value === 'number' && value >= 0) {
        // Check input patterns
        if (this.matchesPattern(lowerKey, this.TOKEN_PATTERNS.inputPatterns)) {
          inputTokens = value;
          detectedFields.inputField = key;
        }
        // Check output patterns
        else if (this.matchesPattern(lowerKey, this.TOKEN_PATTERNS.outputPatterns)) {
          outputTokens = value;
          detectedFields.outputField = key;
        }
        // Check total patterns
        else if (this.matchesPattern(lowerKey, this.TOKEN_PATTERNS.totalPatterns)) {
          totalTokens = value;
          detectedFields.totalField = key;
        }
      }

      // Recurse into nested objects
      if (typeof value === 'object' && value !== null) {
        const nestedResult = this.deepExtract(value, depth + 1, maxDepth);
        if (nestedResult && nestedResult.inputTokens > 0) {
          inputTokens = inputTokens || nestedResult.inputTokens;
          outputTokens = outputTokens || nestedResult.outputTokens;
          totalTokens = totalTokens || nestedResult.totalTokens;
          detectedFields = { ...detectedFields, ...nestedResult.detectedFields };
        }
      }
    }

    // Calculate missing values if we have total
    if (totalTokens > 0) {
      if (inputTokens > 0 && outputTokens === 0) {
        outputTokens = totalTokens - inputTokens;
      } else if (outputTokens > 0 && inputTokens === 0) {
        inputTokens = totalTokens - outputTokens;
      } else if (inputTokens === 0 && outputTokens === 0) {
        // Can't split total without more info, assume 50/50
        inputTokens = Math.floor(totalTokens * 0.4);
        outputTokens = Math.ceil(totalTokens * 0.6);
      }
    } else if (inputTokens > 0 && outputTokens > 0) {
      totalTokens = inputTokens + outputTokens;
    }

    if (inputTokens > 0 || outputTokens > 0) {
      const confidence = (inputTokens > 0 && outputTokens > 0) ? 'high' : 
                        (totalTokens > 0) ? 'medium' : 'low';
      
      return {
        inputTokens,
        outputTokens,
        totalTokens,
        confidence,
        source: 'deep_extraction',
        detectedFields
      };
    }

    return null;
  }

  /**
   * Extract from known usage containers
   */
  private extractFromContainers(response: any): TokenExtractionResult | null {
    for (const container of this.TOKEN_PATTERNS.usageContainers) {
      // Check both camelCase and snake_case variations
      const locations = [
        response[container],
        response[this.toCamelCase(container)],
        response[this.toSnakeCase(container)]
      ];

      for (const usageObj of locations) {
        if (usageObj && typeof usageObj === 'object') {
          const result = this.deepExtract(usageObj, 0, 3);
          if (result && result.inputTokens > 0) {
            result.source = `container:${container}`;
            return result;
          }
        }
      }
    }

    return null;
  }

  /**
   * Fuzzy matching for field names (handles typos and variations)
   */
  private fuzzyExtract(response: any): TokenExtractionResult | null {
    const allKeys = this.getAllKeys(response);
    
    let inputTokens = 0;
    let outputTokens = 0;
    let detectedFields: any = {};

    for (const key of allKeys) {
      const lowerKey = key.toLowerCase();
      const value = this.getValueByPath(response, key);

      if (typeof value === 'number' && value >= 0) {
        // Fuzzy match for input
        if (this.fuzzyMatchInput(lowerKey)) {
          inputTokens = value;
          detectedFields.inputField = key;
        }
        // Fuzzy match for output
        else if (this.fuzzyMatchOutput(lowerKey)) {
          outputTokens = value;
          detectedFields.outputField = key;
        }
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        confidence: 'medium',
        source: 'fuzzy_match',
        detectedFields
      };
    }

    return null;
  }

  /**
   * Extract from response text content (estimation)
   */
  private extractFromText(response: any): TokenExtractionResult {
    let inputText = '';
    let outputText = '';

    // Try to extract text from common response structures
    if (response.messages && Array.isArray(response.messages)) {
      for (const msg of response.messages) {
        if (msg.content) {
          inputText += typeof msg.content === 'string' ? msg.content : '';
        }
      }
    }

    if (response.choices && Array.isArray(response.choices)) {
      for (const choice of response.choices) {
        if (choice.message?.content) {
          outputText += choice.message.content;
        } else if (choice.text) {
          outputText += choice.text;
        }
      }
    } else if (response.content) {
      if (typeof response.content === 'string') {
        outputText = response.content;
      } else if (Array.isArray(response.content)) {
        for (const block of response.content) {
          if (block.text) {
            outputText += block.text;
          }
        }
      }
    } else if (response.text) {
      outputText = response.text;
    } else if (response.output) {
      outputText = typeof response.output === 'string' ? response.output : '';
    }

    const inputTokens = this.estimateTokensFromText(inputText);
    const outputTokens = this.estimateTokensFromText(outputText);

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      confidence: 'low',
      source: 'text_estimation'
    };
  }

  /**
   * Use learned patterns for a specific provider
   */
  private extractUsingLearnedPatterns(response: any, provider: string): TokenExtractionResult | null {
    const patterns = this.learnedPatterns.get(provider);
    if (!patterns || patterns.length === 0) return null;

    let inputTokens = 0;
    let outputTokens = 0;

    for (const pattern of patterns) {
      const value = this.getValueByPath(response, pattern);
      if (typeof value === 'number' && value >= 0) {
        const lowerPattern = pattern.toLowerCase();
        if (this.matchesPattern(lowerPattern, this.TOKEN_PATTERNS.inputPatterns)) {
          inputTokens = value;
        } else if (this.matchesPattern(lowerPattern, this.TOKEN_PATTERNS.outputPatterns)) {
          outputTokens = value;
        }
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        confidence: 'high',
        source: 'learned_patterns'
      };
    }

    return null;
  }

  /**
   * Learn successful extraction patterns
   */
  private learnPattern(provider: string, fields: any): void {
    if (!this.learnedPatterns.has(provider)) {
      this.learnedPatterns.set(provider, []);
    }

    const patterns = this.learnedPatterns.get(provider)!;
    
    if (fields.inputField && !patterns.includes(fields.inputField)) {
      patterns.push(fields.inputField);
    }
    if (fields.outputField && !patterns.includes(fields.outputField)) {
      patterns.push(fields.outputField);
    }

    console.log(`[UNIVERSAL-EXTRACTOR] Learned pattern for ${provider}:`, fields);
  }

  // ========== Helper Methods ==========

  private matchesPattern(key: string, patterns: string[]): boolean {
    return patterns.some(pattern => key === pattern || key.includes(pattern));
  }

  private fuzzyMatchInput(key: string): boolean {
    return key.includes('input') || key.includes('prompt') || key.includes('request') || 
           key.includes('query') || key.includes('in_') || key.includes('_in');
  }

  private fuzzyMatchOutput(key: string): boolean {
    return key.includes('output') || key.includes('completion') || key.includes('response') || 
           key.includes('answer') || key.includes('generated') || key.includes('out_') || key.includes('_out');
  }

  private getAllKeys(obj: any, prefix: string = ''): string[] {
    let keys: string[] = [];
    
    if (!obj || typeof obj !== 'object') return keys;

    for (const key in obj) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      keys.push(fullKey);
      
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        keys = keys.concat(this.getAllKeys(obj[key], fullKey));
      }
    }

    return keys;
  }

  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  private estimateTokensFromText(text: string): number {
    if (!text || typeof text !== 'string') return 0;
    
    // Improved estimation:
    // - Count words and characters
    // - Average: 1 token ≈ 4 characters OR 0.75 words
    const charCount = text.length;
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    
    const charEstimate = Math.ceil(charCount / 4);
    const wordEstimate = Math.ceil(wordCount / 0.75);
    
    // Use average of both methods
    return Math.ceil((charEstimate + wordEstimate) / 2);
  }
}

// Singleton instance
export const universalTokenExtractor = new UniversalTokenExtractor();
