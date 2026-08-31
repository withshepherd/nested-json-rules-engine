'use strict'

import deepClone from 'clone'

/**
 * Walks an evaluated condition tree, collecting the leaf conditions that were satisfied.
 * A "some" nested condition is treated as a leaf: its inner conditions ran against a scoped
 * almanac per array item, so their .result reflects the last item tried, not the rule's decision.
 * @param {Condition} node
 * @param {Boolean} negated - true when the current node is inside an odd number of "not"s
 * @returns {Object[]} serialized (toJSON) leaf conditions
 */
function collectFiredConditions (node, negated) {
  const operator = node.booleanOperator()
  if (operator === 'all' || operator === 'any') {
    return node[operator].reduce((acc, child) => {
      if (child.result === !negated) {
        acc.push(...collectFiredConditions(child, negated))
      }
      return acc
    }, [])
  }
  if (operator === 'not') {
    return collectFiredConditions(node.not, !negated)
  }
  if (node.isConditionReference()) {
    return []
  }
  return node.result === !negated ? [node.toJSON(false)] : []
}

export default class RuleResult {
  constructor (conditions, event, priority, name) {
    this.conditions = deepClone(conditions)
    this.event = deepClone(event)
    this.priority = deepClone(priority)
    this.name = deepClone(name)
    this.result = null
    this.firedConditions = []
  }

  setResult (result) {
    this.result = result
    this.firedConditions = collectFiredConditions(this.conditions, false)
  }

  resolveEventParams (almanac) {
    if (this.event.params !== null && typeof this.event.params === 'object') {
      const updates = []
      for (const key in this.event.params) {
        if (Object.prototype.hasOwnProperty.call(this.event.params, key)) {
          updates.push(
            almanac
              .getValue(this.event.params[key])
              .then((val) => (this.event.params[key] = val))
          )
        }
      }
      return Promise.all(updates)
    }
    return Promise.resolve()
  }

  toJSON (stringify = true) {
    const props = {
      conditions: this.conditions.toJSON(false),
      event: this.event,
      priority: this.priority,
      name: this.name,
      result: this.result
    }
    if (stringify) {
      return JSON.stringify(props)
    }
    return props
  }
}
