name: hello-test
steps:
  - id: hello
    command: printf 'Hello from Lobster!'
  - id: finish
    command: cat
    stdin: $hello.stdout
