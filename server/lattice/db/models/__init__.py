"""Table definitions. Importing this package registers every table on `Base.metadata`."""

from lattice.db.models.identity import Course, Enrolment, User

__all__ = ["Course", "Enrolment", "User"]
