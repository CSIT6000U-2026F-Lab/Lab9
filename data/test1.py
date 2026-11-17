def greet(name):
    return hello(name)


def hello(name):
    return format_message(name)


def format_message(name):
    return f"Hello, {name}!"


def run():
    greet("World")


run()
