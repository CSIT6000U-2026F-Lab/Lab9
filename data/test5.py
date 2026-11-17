def ident(x):
    return x


def add1(x):
    return ident(x)


class Encoder:
    def encode(self, text):
        return ident(text)


class UpperEncoder(Encoder):
    def encode(self, text):
        return add1(text)


class WrapEncoder(Encoder):
    def encode(self, text):
        return ident(text)


def apply(fn, value):
    return fn(value)


def run_encoder(encoder, text):
    return encoder.encode(text)


def start():
    work = apply
    work(add1, 1)
    run_encoder(Encoder(), "a")
    run_encoder(UpperEncoder(), "b")
    run_encoder(WrapEncoder(), "c")


start()
