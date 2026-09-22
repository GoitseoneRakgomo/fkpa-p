from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/gold-and-silver")
def metals():
    return render_template("metals.html")


@app.route("/how-it-works")
def how_it_works():
    return render_template("how_it_works.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/faqs")
def faqs():
    return render_template("faqs.html")


@app.route("/contact")
def contact():
    return render_template("contact.html")


if __name__ == "__main__":
    app.run(debug=True)
