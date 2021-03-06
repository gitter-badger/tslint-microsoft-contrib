import SyntaxKind = require('./utils/SyntaxKind');
import ErrorTolerantWalker = require('./utils/ErrorTolerantWalker');
import AstUtils = require('./utils/AstUtils');
import Utils = require('./utils/Utils');

/**
 * Implementation of the promise-must-complete rule.
 */
export class Rule extends Lint.Rules.AbstractRule {
    public static FAILURE_STRING = 'A Promise was found that appears to not have resolve or reject invoked on all code paths';

    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithWalker(new PromiseAnalyzer(sourceFile, this.getOptions()));
    }
}

class PromiseAnalyzer extends ErrorTolerantWalker {

    private isPromiseDeclaration(node: ts.NewExpression): boolean {
        if (node.expression.kind === SyntaxKind.current().Identifier
            && node.expression.getText() === 'Promise'
            && node.arguments != null && node.arguments.length > 0) {

            let firstArg: ts.Expression = node.arguments[0];
            if (firstArg.kind === SyntaxKind.current().ArrowFunction || firstArg.kind === SyntaxKind.current().FunctionExpression) {
                return true;
            }
        }
        return false;
    }

    private getCompletionIdentifiers(declaration: ts.SignatureDeclaration): ts.Identifier[] {
        var result: ts.Identifier[] = [];
        if (declaration.parameters == null || declaration.parameters.length === 0) {
            return result;
        }

        let arg1: ts.ParameterDeclaration = declaration.parameters[0];
        let arg2: ts.ParameterDeclaration = declaration.parameters[1];
        if (arg1 != null && arg1.name.kind === SyntaxKind.current().Identifier) {
            result.push(<ts.Identifier>declaration.parameters[0].name);
        }
        if (arg2 != null && arg2.name.kind === SyntaxKind.current().Identifier) {
            result.push(<ts.Identifier>declaration.parameters[1].name);
        }
        return result;
    }

    protected visitNewExpression(node: ts.NewExpression): void {
        if (this.isPromiseDeclaration(node)) {
            let functionArgument: ts.FunctionLikeDeclaration = <ts.FunctionLikeDeclaration><any>node.arguments[0];
            let functionBody = functionArgument.body;
            let competionIdentifiers : ts.Identifier[] = this.getCompletionIdentifiers(functionArgument);
            this.validatePromiseUsage(node, functionBody, competionIdentifiers);
        }
        super.visitNewExpression(node);
    }

    private validatePromiseUsage(promiseInstantiation: ts.NewExpression, block: ts.Node, completionIdentifiers: ts.Identifier[]) : void {
        let blockAnalyzer = new PromiseCompletionWalker(this.getSourceFile(), this.getOptions(), completionIdentifiers);
        blockAnalyzer.visitNode(block);
        if (!blockAnalyzer.isAlwaysCompleted()) {
            var failure = this.createFailure(promiseInstantiation.getStart(), promiseInstantiation.getWidth(), Rule.FAILURE_STRING);
            this.addFailure(failure);
        }
    }
}

class PromiseCompletionWalker extends ErrorTolerantWalker {

    private completionIdentifiers: ts.Identifier[];
    private wasCompleted : boolean = false;
    private allBranchesCompleted : boolean = true; // by default, there are no branches, so this is true
    private hasBranches : boolean = false;
    private walkerOptions: Lint.IOptions;

    constructor(sourceFile: ts.SourceFile, options: Lint.IOptions, completionIdentifiers: ts.Identifier[]) {
        super(sourceFile, options);
        this.walkerOptions = options; // we need to store this because this.getOptions() returns undefined even when this has a value
        this.completionIdentifiers = completionIdentifiers;
    }

    // need to make this public so it can invoked from parent walker
    public visitNode(node: ts.Node): void {
        super.visitNode(node);
    }

    public isAlwaysCompleted() : boolean {
        if (this.wasCompleted) {
            return true; // if the main code path completed then it doesn't matter what the child branches did
        }
        if (!this.hasBranches) {
            return false; // if there were no branches and it is not complete... then it is in total not complete.
        }
        return this.allBranchesCompleted; // if main path did *not* complete, the look at child branch status
    }

    protected visitIfStatement(node: ts.IfStatement): void {
        this.hasBranches = true;

        // an if statement is a branch, so we need to see if this branch completes.
        let ifAnalyzer = new PromiseCompletionWalker(this.getSourceFile(), this.walkerOptions, this.completionIdentifiers);
        let elseAnalyzer = new PromiseCompletionWalker(this.getSourceFile(), this.walkerOptions, this.completionIdentifiers);

        ifAnalyzer.visitNode(node.thenStatement);

        if (!ifAnalyzer.isAlwaysCompleted()) {
            this.allBranchesCompleted = false;
        } else if (node.elseStatement != null) {
            elseAnalyzer.visitNode(node.elseStatement);
            if (!elseAnalyzer.isAlwaysCompleted()) {
                this.allBranchesCompleted = false;
            }
        }
        // there is no need to call super.visit because we already took care of walking all the branches
    }

    protected visitCallExpression(node: ts.CallExpression): void {

        if (node.expression.kind === SyntaxKind.current().Identifier) {
            if (this.isCompletionIdentifier(node.expression)) {
                this.wasCompleted = true;
                return; // this branch was completed, do not walk any more.
            }
        }

        let referenceEscaped : boolean = Utils.exists(node.arguments, (argument: ts.Expression) : boolean => {
            return this.isCompletionIdentifier(argument);
        });
        if (referenceEscaped) {
            this.wasCompleted = true;
            return; // this branch was completed, do not walk any more.
        }
        super.visitCallExpression(node);
    }


    protected visitArrowFunction(node: ts.FunctionLikeDeclaration): void {
        // walk into function body but do not track any shadowed identifiers
        var nonShadowedIdentifiers: ts.Identifier[] = this.getNonShadowedCompletionIdentifiers(node);
        let analyzer = new PromiseCompletionWalker(this.getSourceFile(), this.walkerOptions, nonShadowedIdentifiers);
        analyzer.visitNode(node.body);
        if (analyzer.isAlwaysCompleted()) {
            this.wasCompleted = true;
        }
    }

    protected visitFunctionExpression(node: ts.FunctionExpression): void {
        // walk into function body but do not track any shadowed identifiers
        var nonShadowedIdentifiers: ts.Identifier[] = this.getNonShadowedCompletionIdentifiers(node);
        let analyzer = new PromiseCompletionWalker(this.getSourceFile(), this.walkerOptions, nonShadowedIdentifiers);
        analyzer.visitNode(node.body);
        if (analyzer.isAlwaysCompleted()) {
            this.wasCompleted = true;
        }
    }

    private getNonShadowedCompletionIdentifiers(declaration: ts.FunctionLikeDeclaration): ts.Identifier[] {

        let result: ts.Identifier[] = [];
        this.completionIdentifiers.forEach((identifier: ts.Identifier): void => {
            // if this identifier is not shadowed, then add it to result
            var isShadowed: boolean = Utils.exists(declaration.parameters, (parameter: ts.ParameterDeclaration): boolean => {
                return AstUtils.isSameIdentifer(identifier, parameter.name);
            });
            if (!isShadowed) {
                result.push(identifier);
            }
        });

        return result;
    }

    private isCompletionIdentifier(sourceIdentifier: ts.Node): boolean {
        return Utils.exists(this.completionIdentifiers, (identifier: ts.Identifier): boolean => {
            return AstUtils.isSameIdentifer(sourceIdentifier, identifier);
        });

    }
}
