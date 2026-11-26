#ifndef SUITEMAIL_CORE_H
#define SUITEMAIL_CORE_H

char *suitemail_ios_call(const char *command, const char *args);
void suitemail_ios_free(char *result);

#endif
