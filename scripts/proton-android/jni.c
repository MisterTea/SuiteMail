// SPDX-License-Identifier: GPL-3.0-or-later
#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include "_cgo_export.h"

JNIEXPORT jbyteArray JNICALL Java_com_suitemail_app_ProtonBridge_nativeCall(
    JNIEnv *env, jclass type, jbyteArray request
) {
    (void)type;
    jsize length = (*env)->GetArrayLength(env, request);
    jbyte *bytes = (*env)->GetByteArrayElements(env, request, NULL);
    if (bytes == NULL) return NULL;
    char *reply = SuiteMailProtonCall((char *)bytes, length);
    (*env)->ReleaseByteArrayElements(env, request, bytes, JNI_ABORT);
    jsize reply_length = (jsize)strlen(reply);
    jbyteArray result = (*env)->NewByteArray(env, reply_length);
    if (result != NULL) {
        (*env)->SetByteArrayRegion(env, result, 0, reply_length, (const jbyte *)reply);
    }
    free(reply);
    return result;
}
