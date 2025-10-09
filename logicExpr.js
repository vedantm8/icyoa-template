// Minimal safe logical expression evaluator for prerequisites
// Supports: &&, ||, parentheses, and variable names (option IDs)
// Usage: evaluatePrereqExpr(expr, lookupFn)

function evaluatePrereqExpr(expr, lookupFn) {
    if (typeof expr !== 'string') {
        throw new Error('Prerequisite expression must be a string');
    }

    const replaced = expr.replace(/!?[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?/g, (token) => {
        const isNegated = token.startsWith('!');
        const core = isNegated ? token.slice(1) : token;

        const [id, minSuffix] = core.split('__');
        const rawValue = lookupFn(id);
        const numericValue = Number(rawValue) || 0;
        const meetsCount = minSuffix ? numericValue >= Number(minSuffix) : numericValue > 0;
        const result = isNegated ? !meetsCount : meetsCount;
        return result ? 'true' : 'false';
    });

    if (/[^truefals()&|! \t]/.test(replaced.replace(/true|false/g, ''))) {
        throw new Error('Unsafe characters in prerequisite expression');
    }
    // Evaluate using Function constructor (safe after replacement)
    // eslint-disable-next-line no-new-func
    return Function('return (' + replaced + ')')();
}

// Export for browser
if (typeof window !== 'undefined') {
    window.evaluatePrereqExpr = evaluatePrereqExpr;
}

// Export for Node/CommonJS (useful for testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        evaluatePrereqExpr
    };
}
