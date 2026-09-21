"""Repository functions: every query lives here, already scoped to the caller.

Routers stay HTTP-shaped and never build a query, so an authorisation filter cannot be
forgotten in one handler and remembered in another.
"""
