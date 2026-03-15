# Security
api_key = "xk_test_abcdef1234567890abcdef"
password = "SuperSecret12345678!"

result = eval(user_input)
exec("import os; os.remove(file)")
os.system("rm -rf " + user_dir)
subprocess.run(cmd, shell=True)

query = f"SELECT * FROM users WHERE id = {user_id}"
cursor.execute("DELETE FROM logs WHERE date = '{}'".format(date_str))

# Error handling
try:
    risky_operation()
except:
    pass

try:
    another_risky_op()
except Exception:
    pass

try:
    third_op()
except:
    do_something()

# Star import
from os import *
from django.db.models import *

# Mutable defaults
def process_items(items=[], cache={}):
    items.append("new")
    return items

def good_func(items=None):
    if items is None:
        items = []
    return items

# Print in production
print("Debug value:", result)
print(f"User {user_id} logged in")

# Flask debug
app.run(debug=True, port=5000)

# Obvious comments
# initialize the counter
counter = 0
# import the module
import json
# return the result
return total

# Blanket type ignore
x: int = "hello"  # type: ignore
y: str = 42  # type: ignore[assignment]

# AI placeholder TODOs
# TODO: implement error handling
# FIXME: add validation here

# --- Clean code below (should NOT trigger) ---

# Good: specific exception
try:
    something()
except ValueError as e:
    logger.error(f"Value error: {e}")
    raise

# Good: using env vars
api_key = os.environ.get("API_KEY")
secret = config.get("SECRET_KEY")

# Good: parameterized query
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# Good: immutable defaults
def func(name="default", count=0, flag=True):
    pass

# Good: logging module
logging.info("Server started on port %d", port)

# Good: specific type ignore
z: int = compute()  # type: ignore[no-untyped-call]
