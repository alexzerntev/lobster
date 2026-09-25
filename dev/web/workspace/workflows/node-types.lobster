name: Node types
description: One of each node type, connected in execution order.
steps:
  - id: shell_command
    command: printf '["first", "second"]\n'

  - id: lobster_pipeline
    pipeline: head --n 1
    stdin: $shell_command.json

  - id: child_workflow
    workflow: node-types/child.lobster

  - id: parallel_branches
    parallel:
      wait: all
      branches:
        - id: branch_one
          command: printf 'Hello from the first branch!\n'
        - id: branch_two
          command: printf 'Hello from the second branch!\n'

  - id: loop_items
    for_each: $shell_command.json
    steps:
      - id: print_item
        command: cat
        stdin: $item.json
      - id: format_item
        command: "printf 'Processed: '; cat"
        stdin: $print_item.stdout

  - id: approve_example
    approval: Continue to the final input step?

  - id: collect_input
    input:
      prompt: Which node type would you like to explore next?
      responseSchema:
        type: object
        properties:
          nodeType:
            type: string
            enum: [command, pipeline, subworkflow, parallel, loop, approval, input]
        required: [nodeType]
        additionalProperties: false
