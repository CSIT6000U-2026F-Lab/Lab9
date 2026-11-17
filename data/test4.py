def log(msg):
    return msg


def greet(name):
    return log(name)


class Greeter:
    def say(self, name):
        return greet(name)


class LoudGreeter(Greeter):
    def say(self, name):
        return log(name)


def speak(g, name):
    g.say(name)


def start():
    handler = greet
    handler("direct")
    speak(Greeter(), "hi")
    speak(LoudGreeter(), "hi")


start()
