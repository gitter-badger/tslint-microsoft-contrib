
/**
 * A base walker class that gracefully handles unexpected errors.
 * Errors are often thrown when the TypeChecker is invoked.
 */
class ErrorTolerantWalker extends Lint.RuleWalker {


    protected visitNode(node: ts.Node): void {
        try {
            super.visitNode(node);
        } catch (e) {
            var msg: string = 'An error occurred visiting a node.'
                + '\nWalker: ' + this.getClassName()
                + '\nNode: ' + (node.getFullText ? node.getFullText() : '<unknown>')
                + '\n' + e;

            this.addFailure(this.createFailure(
                node.getStart ? node.getStart() : 0,
                node.getWidth ? node.getWidth() : 0,
                msg));
        }
    }

    private getClassName(): string {
        // Some versions of IE have the word "function" in the constructor name and
        // have the function body there as well. This rips out and returns the function name.
        var result: string = this.constructor.toString().match(/function\s+([\w\$]+)\s*\(/)[1] || '';
        if (result == null || result.length === 0) {
            throw new Error('Could not determine class name from input: ' + this.constructor.toString());
        }
        return result;
    }

}

export = ErrorTolerantWalker;