def greet(name):
    return hello(name)


def hello(name):
    return format_message(name)


def format_message(name):
    return f"Hello, {name}!"


def run():
    printer = greet
    printer("World")


class Greeter:
    def __init__(self):
        pass
    def say(self, name):
        return greet(name)


class LoudGreeter(Greeter):
    def __init__(self):
        pass

    def say(self, name):
        return format_message(name)


def speak(g):
    g.say("World")


def start():
    run()
    speak(Greeter())
    speak(LoudGreeter())


start()
