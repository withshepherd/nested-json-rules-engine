'use strict'

import engineFactory from '../src/index'

describe('RuleResult: firedConditions', () => {
  let engine

  beforeEach(() => {
    engine = engineFactory()
  })

  it('reports every leaf in an "all" that fully passes', async () => {
    const conditions = {
      all: [
        { fact: 'age', operator: 'greaterThan', value: 18 },
        { fact: 'balance', operator: 'greaterThan', value: 100 }
      ]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'adult-with-balance' } }))
    engine.addFact('age', 25)
    engine.addFact('balance', 500)

    const { results } = await engine.run()
    expect(results[0].firedConditions).to.have.length(2)
    expect(results[0].firedConditions.map((c) => c.fact)).to.have.members(['age', 'balance'])
  })

  it('reports only the passing leaf in an "any", leaving a short-circuited sibling unreported', async () => {
    const conditions = {
      any: [
        { fact: 'payroll', operator: 'greaterThan', value: 100, priority: 2 },
        { fact: 'revenue', operator: 'greaterThan', value: 999, priority: 1 }
      ]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'threshold-met' } }))
    engine.addFact('payroll', 250)
    engine.addFact('revenue', 10)

    const { results } = await engine.run()

    // the higher-priority "payroll" condition short-circuits the "any", so "revenue"
    // is never evaluated and has no .result at all - not merely a false one
    const [, revenueCondition] = results[0].conditions.any
    expect(revenueCondition.result).to.equal(undefined)

    expect(results[0].firedConditions).to.have.length(1)
    expect(results[0].firedConditions[0].fact).to.equal('payroll')
  })

  it('reports the leaf inside a "not" when negation makes the rule pass', async () => {
    const conditions = {
      not: { fact: 'age', operator: 'greaterThanInclusive', value: 50 }
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'under-50' } }))
    engine.addFact('age', 10)

    const { results } = await engine.run()
    expect(results[0].firedConditions).to.have.length(1)
    expect(results[0].firedConditions[0]).to.include({ fact: 'age', result: false })
  })

  it('handles double negation correctly', async () => {
    const conditions = {
      not: { not: { fact: 'age', operator: 'greaterThanInclusive', value: 50 } }
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'double-negated' } }))
    engine.addFact('age', 60)

    const { results } = await engine.run()
    expect(results[0].firedConditions).to.have.length(1)
    expect(results[0].firedConditions[0]).to.include({ fact: 'age', result: true })
  })

  it('reports nothing for an "all" the rule failed on, at any depth', async () => {
    const conditions = {
      all: [
        { fact: 'age', operator: 'greaterThan', value: 18 },
        { fact: 'balance', operator: 'greaterThan', value: 100 }
      ]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'adult-with-balance' } }))
    engine.addFact('age', 25)
    engine.addFact('balance', 10)

    const { failureResults } = await engine.run()
    expect(failureResults[0].result).to.equal(false)
    expect(failureResults[0].firedConditions).to.deep.equal([])
  })

  // The same partially-passing group must answer the same way whether it is the root or nested.
  it('reports only the branch that decided an "any" over two groups', async () => {
    const conditions = {
      any: [
        {
          all: [
            { fact: 'age', operator: 'greaterThan', value: 18 },
            { fact: 'balance', operator: 'greaterThan', value: 999 }
          ]
        },
        { all: [{ fact: 'member', operator: 'equal', value: true }] }
      ]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'eligible' } }))
    engine.addFact('age', 25)
    engine.addFact('balance', 10)
    engine.addFact('member', true)

    const { results } = await engine.run()
    expect(results[0].firedConditions.map((c) => c.fact)).to.deep.equal(['member'])
  })

  it('flips the test for every leaf under a "not" wrapping an "any"', async () => {
    const conditions = {
      not: {
        any: [
          { fact: 'age', operator: 'greaterThan', value: 50 },
          { fact: 'balance', operator: 'greaterThan', value: 999 }
        ]
      }
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'neither' } }))
    engine.addFact('age', 25)
    engine.addFact('balance', 10)

    const { results } = await engine.run()
    expect(results[0].firedConditions.map((c) => c.fact)).to.have.members(['age', 'balance'])
    expect(results[0].firedConditions.every((c) => c.result === false)).to.equal(true)
  })

  it('is an empty array when a simple "all" rule fails', async () => {
    const conditions = {
      all: [{ fact: 'age', operator: 'lessThan', value: 18 }]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'minor' } }))
    engine.addFact('age', 25)

    const { failureResults } = await engine.run()
    expect(failureResults[0].result).to.equal(false)
    expect(failureResults[0].firedConditions).to.deep.equal([])
  })

  it('carries fact, operator, value, factResult, result, metadata, and path on a reported leaf', async () => {
    const conditions = {
      all: [{
        fact: 'subject',
        path: '$.amount',
        operator: 'greaterThan',
        value: 100,
        metadata: { conditionFieldId: 'field-1' }
      }]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'over-threshold' } }))
    engine.addFact('subject', { amount: 250 })

    const { results } = await engine.run()
    expect(results[0].firedConditions).to.deep.equal([{
      fact: 'subject',
      path: '$.amount',
      operator: 'greaterThan',
      value: 100,
      factResult: 250,
      valueResult: 100,
      result: true,
      metadata: { conditionFieldId: 'field-1' }
    }])
  })

  it('reports a matching "some" nested condition as a single entry, without its inner conditions', async () => {
    const conditions = {
      all: [{
        fact: 'payrollItems',
        operator: 'some',
        conditions: {
          all: [
            { fact: 'type', operator: 'equal', value: 'bonus' },
            { fact: 'amount', operator: 'greaterThan', value: 300 }
          ]
        }
      }]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'bonus-threshold-met' } }))
    engine.addFact('payrollItems', [
      { type: 'bonus', amount: 500 },
      { type: 'salary', amount: 1000 },
      { type: 'bonus', amount: 200 }
    ])

    const { results } = await engine.run()
    expect(results[0].firedConditions).to.have.length(1)
    expect(results[0].firedConditions[0].fact).to.equal('payrollItems')
    expect(results[0].firedConditions[0].operator).to.equal('some')
    expect(results[0].firedConditions[0]).to.not.have.property('type')
  })

  it('does not appear in ruleResult.toJSON(false) or JSON.stringify(ruleResult)', async () => {
    const conditions = {
      all: [{ fact: 'age', operator: 'greaterThan', value: 18 }]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'adult' } }))
    engine.addFact('age', 25)

    const { results } = await engine.run()
    const json = results[0].toJSON(false)
    expect(json).to.not.have.property('firedConditions')
    expect(JSON.stringify(results[0])).to.not.contain('firedConditions')
  })

  it('sets .result on the root of ruleResult.conditions for "all", "any", and "not" rules', async () => {
    engine.addRule(factories.rule({
      name: 'all-rule',
      conditions: { all: [{ fact: 'age', operator: 'greaterThan', value: 18 }] },
      event: { type: 'all-rule-event' }
    }))
    engine.addRule(factories.rule({
      name: 'any-rule',
      conditions: { any: [{ fact: 'age', operator: 'greaterThan', value: 18 }] },
      event: { type: 'any-rule-event' }
    }))
    engine.addRule(factories.rule({
      name: 'not-rule',
      conditions: { not: { fact: 'age', operator: 'lessThan', value: 18 } },
      event: { type: 'not-rule-event' }
    }))
    engine.addFact('age', 25)

    const { results } = await engine.run()
    expect(results).to.have.length(3)
    results.forEach((ruleResult) => {
      expect(ruleResult.conditions.result).to.equal(true)
    })
  })

  it('serializes a nested boolean node\'s own .result through toJSON(false)', async () => {
    const conditions = {
      not: {
        all: [{ fact: 'age', operator: 'lessThan', value: 18 }]
      }
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'not-a-minor' } }))
    engine.addFact('age', 25)

    const { results } = await engine.run()
    const json = results[0].toJSON(false)
    expect(json.conditions.result).to.equal(true)
    expect(json.conditions.not.result).to.equal(false)
  })

  it('serializes an unresolved condition reference\'s own .result through toJSON(false)', async () => {
    engine = engineFactory([], { allowUndefinedConditions: true })
    const conditions = {
      any: [
        { condition: 'conditionThatIsNotDefined' },
        { fact: 'age', operator: 'greaterThanInclusive', value: 21 }
      ]
    }
    engine.addRule(factories.rule({ conditions, event: { type: 'of-age' } }))
    engine.addFact('age', 25)

    const { results } = await engine.run()
    const reference = results[0].conditions.any[0]
    const json = results[0].toJSON(false)

    expect(reference.result).to.equal(false)
    expect(json.conditions.any[0].result).to.equal(false)
    expect(results[0].firedConditions).to.have.length(1)
    expect(results[0].firedConditions[0].fact).to.equal('age')
  })
})
