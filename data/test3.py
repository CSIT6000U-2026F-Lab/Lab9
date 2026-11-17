class Animal:
    def speak(self):
        return "..."


class Dog(Animal):
    def speak(self):
        return "woof"


class Cat(Animal):
    def speak(self):
        return "meow"


def say(animal):
    animal.speak()


def start():
    say(Dog())
    say(Cat())


start()
