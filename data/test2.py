def foo():
    return 1


def bar():
    a = foo
    a()


def apply(f):
    f()


def start():
    printer = bar
    printer()
    apply(foo)


start()
